interface GitHubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

interface Config {
  githubToken: string;
  githubRepo: string;
  s3Bucket: string;
  s3Endpoint: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
}

const config: Config = {
  githubToken: process.env.GITHUB_TOKEN!,
  githubRepo: process.env.GITHUB_REPO || "egoist/chatwise-releases",
  s3Bucket: process.env.S3_BUCKET || "gh-releases",
  s3Endpoint: process.env.S3_ENDPOINT!,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
};

const s3Client = new Bun.S3Client({
  bucket: config.s3Bucket,
  endpoint: config.s3Endpoint,
  accessKeyId: config.awsAccessKeyId,
  secretAccessKey: config.awsSecretAccessKey,
});

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${config.githubRepo}/releases/latest`,
    {
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        "User-Agent": "sync-release",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as any;
}

async function downloadAsset(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      "User-Agent": "sync-release",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download asset: ${response.status} ${response.statusText}`
    );
  }

  return await response.arrayBuffer();
}

async function uploadToS3(
  buffer: ArrayBufferLike,
  key: string,
  contentType?: string
): Promise<void> {
  await s3Client.write(key, new Uint8Array(buffer), {
    type: contentType || "application/octet-stream",
  });
}

async function syncReleaseAssets(): Promise<void> {
  try {
    console.log("Fetching latest release...");
    const release = await fetchLatestRelease();

    console.log(
      `Found release: ${release.tag_name} with ${release.assets.length} assets`
    );

    for (const asset of release.assets) {
      const s3Key = `${config.githubRepo}/${release.tag_name}/${asset.name}`;

      console.log(`Downloading ${asset.name} (${asset.size} bytes)...`);
      const buffer = await downloadAsset(asset.browser_download_url);

      console.log(`Uploading to S3: ${s3Key}...`);
      await uploadToS3(buffer, s3Key);

      console.log(` Synced ${asset.name}`);
    }

    const metaKey = `${config.githubRepo}/latest.json`;
    console.log(`Uploading release metadata to S3: ${metaKey}...`);
    const metaBuffer = new TextEncoder().encode(
      JSON.stringify(release, null, 2)
    );
    await uploadToS3(metaBuffer.buffer, metaKey, "application/json");
    console.log(` Synced latest.json`);

    console.log(
      `Successfully synced ${release.assets.length} assets from ${release.tag_name}`
    );
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  syncReleaseAssets();
}
