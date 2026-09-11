export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ModalSubmit: 5
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  Modal: 9
} as const;

export const EPHEMERAL = 1 << 6;

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function ephemeral(content: string): Response {
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: { content, flags: EPHEMERAL } });
}

export function deferredEphemeral(): Response {
  return jsonResponse({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: EPHEMERAL }
  });
}
