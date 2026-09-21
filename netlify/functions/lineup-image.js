const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: 'Missing id' };
  }

  const store = getStore({
    name: 'lineup-images',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  const buffer = await store.get(id, { type: 'arrayBuffer' });
  if (!buffer) {
    return { statusCode: 404, body: 'Not found' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true,
  };
};
