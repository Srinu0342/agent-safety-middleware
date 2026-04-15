export const anthropicToOpenAIBodyTransformer = (
  anthropicBody: Record<string, unknown>,
): Record<string, unknown> => {
  // This is a very basic transformation and may need to be expanded based on the actual differences
  throw new Error("anthropicToOpenAIBodyTransformer is not implemented yet");
};

export const anthropicToOpenAIHeaderTransformer = (
  anthropicHeaders: Record<string, string>,
): Record<string, string> => {
  // This is a very basic transformation and may need to be expanded based on the actual differences
  throw new Error("anthropicToOpenAIHeaderTransformer is not implemented yet");
};

export const anthropicToOpenAIResponseTransformer = (
  anthropicResponse: Record<string, unknown>,
): Record<string, unknown> => {
  // This is a very basic transformation and may need to be expanded based on the actual differences
  throw new Error("anthropicToOpenAIResponseTransformer is not implemented yet");
};