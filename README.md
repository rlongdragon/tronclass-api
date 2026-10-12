English | [中文](./README_zh-tw.md)

# tronclass API

An unofficial TronClass (tronclass.com) API library, encapsulating login, session maintenance, and common API calls to facilitate automated access to TronClass user data and course information in Node.js / TypeScript projects.
> Script source: [@silvercow002/tronclass-script](https://github.com/silvercow002/tronclass-script)
>
> References [@seven-317/Tronclass-API](https://github.com/seven-317/Tronclass-API) (MIT) for response checking, pagination, homework endpoints and download filename parsing

## Key Features

- Automatically handles sessions after login using a cookie jar.
- Parses the login page to extract the CSRF token (lt) and complete form-based login; the captcha is solved by an OCR function supplied by the caller.
- Detects expired sessions (redirects back to the CAS login page), logs in again automatically and resends the request.
- Automatic retries and a simple error handling mechanism.
- Provides simple wrapper methods (e.g., `recentlyVisitedCourses`) and a generic `call` method to invoke any API endpoint.
- All logs go to stderr; stdout is left untouched.

## Directory Structure

- `src/` - TypeScript source code.
- `dist/` - Compiled JavaScript and type declarations (built automatically by `npm install`).
- `example/` - Usage example (`example/example.js`).

## Quick Start

After cloning this project, install the dependencies; the `prepare` script builds `dist/` automatically:
```bash
npm install
```

Create a `.env` file in the project root (it is already listed in `.gitignore`):
```
TRON_USER=your_username
TRON_PASS=your_password
TRON_BASE_URL=https://tronclass.ntou.edu.tw
```

`example/example.js` uses `captcha-nodejs-module`, the author's own OCR module, which is not published on npm. If you don't have it, just drop the OCR argument from `login()` (NTOU supports captcha-free CAS REST login; see "Login and Captcha" below), then run the example:
```bash
npm run example
```

## Installation

This project hasn't been published to npm yet. You can add it in either of these ways.

From GitHub (npm builds it during installation):
```json
{
  "dependencies": {
    "tronclass-api": "github:rlongdragon/tronclass-api"
  }
}
```

Or from a local path (change it to your local absolute path, and run `npm install` in that directory first so `dist/` exists):
```json
{
  "dependencies": {
    "tronclass-api": "file:/absolute/path/to/tronclass-api"
  }
}
```

## Login and Captcha

`login()` first uses the CAS REST protocol (`/cas/v1/tickets`) to exchange the credentials for a ticket, which **needs no captcha**. NTOU supports this, so normally the credentials are enough:

```javascript
const result = await tron.login("your_username", "your_password");
```

Wrong credentials return `reason: "credentials"` without trying anything else. Only when REST is unavailable does it fall back to the CAS login page, which has required a 4-digit image captcha since 2025/10/13; that path needs the optional third argument, an OCR function:

```typescript
type Ocr = (dataUrl: string) => Promise<string>;
```

- `dataUrl`: the captcha image, as `data:image/jpeg;base64,...`.
- Return value: the recognized 4-digit string. Anything other than 4 digits makes that login attempt fail immediately; when CAS rejects the captcha, a new one is fetched and retried.

When a session expires, the library logs in again with the same credentials (and the OCR function, if given).

The login flow follows NTOU's CAS login page; other schools' login pages may differ.

## Usage Instructions

This package is an ES module, so use it from an ESM project:

```javascript
import Tronclass from "tronclass-api";

const tron = new Tronclass();
tron.setBaseUrl("https://tronclass.ntou.edu.tw"); // Your school's TronClass URL
const result = await tron.login("your_username", "your_password");
if (!result.success) throw new Error(result.message);

const courses = await tron.recentlyVisitedCourses();
console.log(courses);
```

TypeScript projects can import the types directly:

```typescript
import Tronclass, { type Course, type TodoList } from "tronclass-api";
```

## Saving the session

After logging in you can export the session and restore it next time instead of logging in again:

```javascript
const saved = await tron.exportSession(); // a string equivalent to login credentials; store it where only you can read it

// next start
const tron = new Tronclass();
tron.setBaseUrl("https://tronclass.ntou.edu.tw");
await tron.importSession(saved);
tron.setCredentials("your_username", "your_password"); // used to log in again if the session has expired
```

## Rate limiting

To avoid being blocked by the server due to overly frequent requests, the Tronclass class includes a simple rate-limiting mechanism. When requests are too frequent, a `RateLimitError` is thrown and includes a `waitTime` property indicating the suggested wait time (milliseconds). Callers can use this information to decide when to retry.

```typescript
import Tronclass, { RateLimitError } from "tronclass-api";

try {
  const courses = await tron.recentlyVisitedCourses();
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limit exceeded. Please wait ${error.waitTime} ms before retrying.`);
    // You can add wait logic here, for example using setTimeout or a sleep helper
  } else {
    // Handle other errors
    console.error("An error occurred:", error);
  }
}
```
Default rate limiting is set to no more than 60 requests per minute. You can adjust this limit as needed.
```typescript
tron.fetcherRPM = 200;
```

## API Sources

TronClass has no public API documentation. The endpoints and parameters here were collected from the sources below and then verified with an NTOU account on `tronclass.ntou.edu.tw`. Only endpoints and flows were referenced; no code was copied.

| Source | What was referenced |
|---|---|
| [silvercow002/tronclass-script](https://github.com/silvercow002/tronclass-script) | NTOU CAS login flow, recently visited courses |
| [seven-317/Tronclass-API](https://github.com/seven-317/Tronclass-API) (MIT) | Endpoints for semesters, courses, modules, bulletins, materials, exam scores; response checking, pagination and download filename parsing |
| [RX5950XT/FJU-TronClass-MCP](https://github.com/RX5950XT/FJU-TronClass-MCP) | Profile, course bulletins, groups, homework upload and draft flow |
| [andyching168/tronclass_control](https://github.com/andyching168/tronclass_control) | Profile, notifications (`/ntf`) and their types, submission lists |
| [GGQQmax/iclass-mcp](https://github.com/GGQQmax/iclass-mcp) | Cross-course bulletins (`/api/course-bulletins`), attachment download, forum |
| [eWloYW8/zju-courses-go-sdk](https://github.com/eWloYW8/zju-courses-go-sdk) | Endpoint catalog for notifications, submissions, groups and scores |
| [8eoyw/zju-learning-cli](https://github.com/8eoyw/zju-learning-cli) | Attachment download, preview PDF, forum paging |
| [TW-RF54732/tronclass-calender](https://github.com/TW-RF54732/tronclass-calender) | Course activities, exam list |
| [yd-tw/ind-hackathon](https://github.com/yd-tw/ind-hackathon) | NTOU `my-courses` parameters and todos |
| [BobLiu0518/TronClass-Resource-Download](https://github.com/BobLiu0518/TronClass-Resource-Download) | Document preview URL |
| NTOU TronClass public web frontend (`tronclass.ntou.edu.tw/static`) | Request formats for homework upload, draft/submit, retract and group submission lists |

Verification (2026-10-12): all read APIs were verified on NTOU; `uploadFile`, `saveSubmission`, `retractSubmission` and `deleteUpload` were only tested with mocks; `getTopic` is unverified because no forum topic was available.

> English version translated by AI
