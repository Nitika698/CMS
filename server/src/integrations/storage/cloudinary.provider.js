/**
 * Cloudinary storage. Assets are uploaded SERVER-SIDE (so size and type validation has already happened) as
 * `authenticated` resources, which Cloudinary refuses to deliver without a signed URL, and each user gets their own
 * folder. The SDK is injected so tests can verify the exact calls without network access.
 *
 * NOTE: not exercised against the real service in this repo's tests (no credentials). Verify with your account
 * before relying on it. Signed `authenticated` URLs do not expire unless token-based delivery is enabled on the
 * Cloudinary account; our own link to the file (GET /media/:id/file) always requires a valid session or short-lived token.
 */
export function createCloudinaryProvider({ cloudinary }) {
  const resource = (asset) => (asset.resourceType === 'document' ? 'image' : asset.resourceType); // PDFs are "image" resources in Cloudinary

  return {
    name: 'cloudinary',

    async save({ ownerId, tempPath, resourceType }) {
      const result = await cloudinary.uploader.upload(tempPath, {
        resource_type: resourceType === 'document' ? 'image' : resourceType,
        type: 'authenticated',
        folder: `cms/${ownerId}`,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      });
      return { storageKey: result.public_id };
    },

    async remove(asset) {
      await cloudinary.uploader.destroy(asset.storageKey, { resource_type: resource(asset), type: 'authenticated', invalidate: true });
    },

    /** Redirects to a signed delivery URL (only reachable after our own authorisation check). */
    async serve(asset, _req, res) {
      const url = cloudinary.url(asset.storageKey, {
        resource_type: resource(asset),
        type: 'authenticated',
        sign_url: true,
        secure: true,
        ...(asset.resourceType === 'document' ? { format: 'pdf' } : {}),
      });
      res.set('Cache-Control', 'no-store').redirect(302, url);
    },

    async removeOwner() {
      /* folder cleanup is done by Cloudinary admin tooling; not needed for normal operation */
    },
  };
}
