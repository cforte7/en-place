import { app, openApiDocumentConfig } from "./app";

const document = app.getOpenAPIDocument(openApiDocumentConfig);
const output = new URL("../../macos/EnPlace/openapi.json", import.meta.url);

await Bun.write(output, `${JSON.stringify(document, null, 2)}\n`);
