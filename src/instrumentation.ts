import { loadApplicationRuntimeConfig } from "@/config/runtime";

export function register(): void {
  if (process.env.NODE_ENV === "production") {
    loadApplicationRuntimeConfig(process.env);
  }
}
