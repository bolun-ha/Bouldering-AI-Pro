// GET /.netlify/functions/jwt — Generate JWT for browser-side Realtime WebSocket
import crypto from "crypto";
import { ZHIPU_API_KEY, corsHeaders, handleOptions } from "./_shared.mjs";

function base64url(str) {
  return Buffer.from(str).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function generateJWT(apiKey, expireSeconds = 60) {
  const dot = apiKey.indexOf(".");
  if (dot === -1) throw new Error("Invalid API key format");
  const api_key = apiKey.slice(0, dot);
  const api_secret = apiKey.slice(dot + 1);

  const exp = Math.floor(Date.now() / 1000) + expireSeconds;
  const timestamp = Date.now();

  const header = { alg: "HS256", sign_type: "SIGN" };
  const payload = { api_key, exp, timestamp };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", api_secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  console.log(`JWT generated: expires in ${expireSeconds}s`);
  return `${headerB64}.${payloadB64}.${signature}`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const token = generateJWT(ZHIPU_API_KEY, 60);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Cache-Control": "no-store", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    };
  } catch (error) {
    console.error("jwt Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
