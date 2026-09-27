import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer(env: Env) {
	const server = new McpServer({
		name: "Google Flow Video Creator",
		version: "1.0.0",
	});

	server.registerTool(
		"generate_veo_video",
		{
			description:
				"Generate an 8-second video with Google Veo 3.1. Returns the generated video URL.",
			inputSchema: {
				prompt: z.string().min(1),
				aspectRatio: z
					.enum(["9:16", "16:9"])
					.default("9:16"),
				resolution: z
					.enum(["720p", "1080p", "4k"])
					.default("720p"),
			},
		},
		async ({ prompt, aspectRatio, resolution }) => {
			const response = await fetch(
				"https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-goog-api-key": env.GEMINI_API_KEY,
					},
					body: JSON.stringify({
						instances: [{ prompt }],
						parameters: {
							aspectRatio,
							resolution,
						},
					}),
				},
			);

			if (!response.ok) {
				return {
					content: [
						{
							type: "text",
							text: `Veo API error: ${response.status} ${await response.text()}`,
						},
					],
				};
			}

			const operation = (await response.json()) as {
				name?: string;
			};

			if (!operation.name) {
				return {
					content: [
						{
							type: "text",
							text: "Veo did not return an operation name.",
						},
					],
				};
			}

			for (let attempt = 0; attempt < 60; attempt++) {
				await new Promise((resolve) =>
					setTimeout(resolve, 10000),
				);

				const statusResponse = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/${operation.name}`,
					{
						headers: {
							"x-goog-api-key": env.GEMINI_API_KEY,
						},
					},
				);

				if (!statusResponse.ok) {
					return {
						content: [
							{
								type: "text",
								text: `Veo status error: ${statusResponse.status} ${await statusResponse.text()}`,
							},
						],
					};
				}

				const status = (await statusResponse.json()) as {
					done?: boolean;
					error?: {
						message?: string;
					};
					response?: {
						generateVideoResponse?: {
							generatedSamples?: Array<{
								video?: {
									uri?: string;
								};
							}>;
						};
					};
				};

				if (status.error) {
					return {
						content: [
							{
								type: "text",
								text: `Veo generation failed: ${
									status.error.message ??
									"Unknown error"
								}`,
							},
						],
					};
				}

				if (status.done) {
					const videoUrl =
						status.response
							?.generateVideoResponse
							?.generatedSamples?.[0]
							?.video?.uri;

					if (!videoUrl) {
						return {
							content: [
								{
									type: "text",
									text: "Veo finished but did not return a video URL.",
								},
							],
						};
					}

					return {
						content: [
							{
								type: "text",
								text: `Video generated successfully.\n\n${videoUrl}`,
							},
						],
					};
				}
			}

			return {
				content: [
					{
						type: "text",
						text: "Video generation timed out while waiting for Veo.",
					},
				],
			};
		},
	);

	return server;
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const handler = createMcpHandler(() => createServer(env));
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
