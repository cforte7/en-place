import {
  configure,
  getConsoleSink,
  getLogger,
  isLogLevel,
  jsonLinesFormatter,
  type LogLevel,
} from "@logtape/logtape";

const isProduction = Bun.env.NODE_ENV === "production";

function resolveLogLevel(): LogLevel {
  const configuredLevel = Bun.env.LOG_LEVEL;

  if (!configuredLevel) {
    return isProduction ? "info" : "debug";
  }

  if (!isLogLevel(configuredLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${configuredLevel}`);
  }

  return configuredLevel;
}

export async function configureLogging(): Promise<void> {
  const consoleSink = isProduction
    ? getConsoleSink({ formatter: jsonLinesFormatter })
    : getConsoleSink();

  await configure({
    sinks: {
      console: consoleSink,
    },
    loggers: [
      {
        category: ["en-place"],
        lowestLevel: resolveLogLevel(),
        sinks: ["console"],
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
    ],
  });
}

export const applicationLogger = getLogger(["en-place", "application"]);
export const authLogger = getLogger(["en-place", "auth"]);
export const httpLogger = getLogger(["en-place", "http"]);
export const usersLogger = getLogger(["en-place", "users"]);
