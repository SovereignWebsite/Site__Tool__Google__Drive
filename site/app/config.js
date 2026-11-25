// Public values only. A Google OAuth client ID and a browser API key are public by design (they are in every
// page that uses them); the client is limited by the origins listed in Google Cloud, and the key by its referrers.
// Never put a client secret here: the token flow in the browser has none. Dinis owns these values (see /app/setup/).
window.DRIVE_CONFIG = {
  clientId: "",          // OAuth 2.0 Web client ID, ends .apps.googleusercontent.com
  apiKey: "",            // Browser API key, restricted to this site and the Picker API
  appId: "",             // Google Cloud project number (the Picker needs it to grant drive.file access)
  scope: "https://www.googleapis.com/auth/drive.file"
};
