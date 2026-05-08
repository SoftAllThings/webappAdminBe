import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const bucket = process.env.S3_BUCKET || "softallthingspoops";
const folder = (process.env.S3_FOLDER || "images/").replace(/\/?$/, "/");

let cachedClient: S3Client | null = null;

const getClient = (): S3Client => {
  if (cachedClient) return cachedClient;

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS credentials missing (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)"
    );
  }

  cachedClient = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface UploadedImage {
  s3Key: string;
  s3Url: string;
}

export const uploadImage = async (
  recordId: string,
  bytes: Buffer,
  contentType: string = "image/jpeg",
  extension: string = "jpg"
): Promise<UploadedImage> => {
  const client = getClient();
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 15);
  const s3Key = `${folder}${recordId}_${timestamp}_${randomUUID()}.${extension}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: bytes,
      ContentType: contentType,
    })
  );

  const s3Url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
    { expiresIn: ONE_YEAR_SECONDS }
  );

  return { s3Key, s3Url };
};
