import type { DiscordInteraction, DiscordUser } from "../types";

export function interactionUser(interaction: DiscordInteraction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

export function modalValue(interaction: DiscordInteraction, customId: string): string | null {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId && typeof component.value === "string") return component.value;
    }
  }
  return null;
}
