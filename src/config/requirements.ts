import type { RoleKey } from "../types";

export const MINIMUM_AGE = 15;
export const MINIMUM_DAILY_ONLINE = 4;
export const RUST_APP_ID = 252490;
export const COOLDOWN_SECONDS = 30;

export const ROLE_REQUIREMENTS = {
  combat: {
    emoji: "⚔️",
    label: "PvE / Combat",
    description: "Основное боевое направление",
    minimumRustHours: 3500
  },
  farm: {
    emoji: "🌾",
    label: "Farm",
    description: "Фарм ресурсов и обеспечение команды",
    minimumRustHours: 2000
  },
  builder: {
    emoji: "🔧",
    label: "Builder",
    description: "Строительство и развитие базы",
    minimumRustHours: 3000
  },
  industrial: {
    emoji: "🏭",
    label: "Industrial",
    description: "Промышленные системы и автоматизация",
    minimumRustHours: 2000
  },
  electric: {
    emoji: "⚡",
    label: "Electric",
    description: "Электрика и техническая инфраструктура",
    minimumRustHours: 2000
  },
  pilot: {
    emoji: "🚁",
    label: "Pilot",
    description: "Пилотирование и транспорт",
    minimumRustHours: 1500
  }
} as const satisfies Record<RoleKey, {
  emoji: string;
  label: string;
  description: string;
  minimumRustHours: number;
}>;

export function isRoleKey(value: string): value is RoleKey {
  return Object.hasOwn(ROLE_REQUIREMENTS, value);
}
