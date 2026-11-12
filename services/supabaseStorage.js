const { createClient } = require("@supabase/supabase-js");

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "applicant-documents";

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return null;
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function uploadPassport({ objectPath, buffer, contentType }) {
  if (process.env.NODE_ENV === "test") {
    return { path: objectPath };
  }
  const client = getStorageClient();
  if (!client) {
    throw new Error("SUPABASE_STORAGE_NOT_CONFIGURED");
  }

  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`SUPABASE_UPLOAD_FAILED:${error.message || "unknown"}`);
  }
  return data;
}

async function removePassport(objectPath) {
  const client = getStorageClient();
  if (!client || !objectPath) {
    return;
  }
  await client.storage.from(STORAGE_BUCKET).remove([objectPath]);
}

async function createPassportSignedUrl(objectPath, expiresInSeconds = 3600) {
  const client = getStorageClient();
  if (!client) {
    throw new Error("SUPABASE_STORAGE_NOT_CONFIGURED");
  }
  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error("SUPABASE_SIGNED_URL_FAILED");
  }
  return data.signedUrl;
}

module.exports = {
  STORAGE_BUCKET,
  uploadPassport,
  removePassport,
  createPassportSignedUrl,
};
