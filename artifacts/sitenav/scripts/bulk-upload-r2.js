process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Configure S3 client (Cloudflare R2)
const s3Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET || "ulez-design-pdfs";
const PDF_DIR = 'C:\\Users\\yu007637\\OneDrive - Yunex\\Documents\\Software Development\\sitenav\\public\\pdfs\\ulez';

async function uploadPdf(fileName, filePath) {
    try {
        const fileStream = fs.createReadStream(filePath);
        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: fileStream,
            ContentType: 'application/pdf',
        };

        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);
        console.log(`[SUCCESS] Uploaded: ${fileName}`);
        return true;
    } catch (err) {
        console.error(`[ERROR] Failed to upload ${fileName}:`, err.message);
        return false;
    }
}

async function main() {
    console.log(`--- Starting Bulk Cloudflare R2 Migration ---`);
    console.log(`Target Bucket: ${BUCKET_NAME}`);
    console.log(`Source Folder: ${PDF_DIR}`);

    if (!fs.existsSync(PDF_DIR)) {
        console.error(`[ERROR] Directory not found: ${PDF_DIR}`);
        return;
    }

    const files = fs.readdirSync(PDF_DIR).filter(file => file.endsWith('.pdf'));
    console.log(`Found ${files.length} PDFs. Uploading...`);

    let successCount = 0;
    let failCount = 0;

    // Concurrency limit of 10
    const concurrency = 10;
    for (let i = 0; i < files.length; i += concurrency) {
        const chunk = files.slice(i, i + concurrency);
        const results = await Promise.all(chunk.map(file => {
            const filePath = path.join(PDF_DIR, file);
            return uploadPdf(file, filePath);
        }));
        
        results.forEach(success => {
            if (success) successCount++;
            else failCount++;
        });
        console.log(`Progress: ${successCount + failCount} / ${files.length}`);
    }

    console.log(`\n--- Upload Complete ---`);
    console.log(`Successfully Uploaded: ${successCount}`);
    console.log(`Failed Uploads: ${failCount}`);
}

main();
