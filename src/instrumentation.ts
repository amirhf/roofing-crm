import { loadOracleRuntimeConfig } from "@/config/oracle";

export function register(): void {
  if (process.env.NODE_ENV === "production") {
    loadOracleRuntimeConfig(process.env);
  }
}
