[English](./README.md) | 中文

# tronclass API

一個非官方的 TronClass（tronclass.com）API 工具庫，封裝登入、會話維護與常用 API 呼叫，方便在 Node.js / TypeScript 專案中自動化存取 TronClass 的使用者資料與課程資訊。
> 腳本來源 [@silvercow002/tronclass-script](https://github.com/silvercow002/tronclass-script)
>
> 參考 [@seven-317/Tronclass-API](https://github.com/seven-317/Tronclass-API)（MIT）：API 回應檢查、自動翻頁、作業相關 endpoint 與下載檔名解析的做法

## 主要功能

- 使用 cookie jar 自動處理登入後的 session。
- 解析登入頁面以抓取 CSRF token（lt）並完成表單登入，驗證碼交給呼叫端傳入的 OCR 函數辨識。
- 偵測 session 過期（被導回 CAS 登入頁），自動重新登入並重送請求。
- 自動重試與簡單的錯誤處理機制。
- 提供簡單的包裝方法（例如 `recentlyVisitedCourses`）與通用的 `call` 方法以呼叫任意 API endpoint。
- log 一律輸出到 stderr，不佔用 stdout。

## 目錄

- `src/` - TypeScript 原始碼。
- `dist/` - 編譯後的 JavaScript 與型別定義（`npm install` 時自動 build）。
- `example/` - 使用範例（`example/example.js`）。

## 快速開始

clone 此專案後安裝依賴，`prepare` 會自動 build 到 `dist/`：
```bash
npm install
```

在專案根目錄建立 `.env`（已列在 `.gitignore`）：
```
TRON_USER=你的帳號
TRON_PASS=你的密碼
TRON_BASE_URL=https://tronclass.ntou.edu.tw
```

`example/example.js` 使用的 `captcha-nodejs-module` 是作者自己的 OCR 模組，沒有發布在 npm 上。如果你沒有這個模組，請先換成你自己的 OCR 函數（見下方「登入與驗證碼」），然後執行範例：
```bash
npm run example
```

## 安裝

此專案還沒上傳到 npm，可以用以下兩種方式引入。

從 GitHub 安裝（npm 會在安裝時自動 build）：
```json
{
  "dependencies": {
    "tronclass-api": "github:rlongdragon/tronclass-api"
  }
}
```

或從本地路徑引入（請將路徑改成你本地的絕對路徑，並先在該目錄執行過 `npm install` 以產生 `dist/`）：
```json
{
  "dependencies": {
    "tronclass-api": "file:/absolute/path/to/tronclass-api"
  }
}
```

## 登入與驗證碼

海大 TronClass 的 CAS 登入頁自 2025/10/13 起需要輸入 4 位數字的圖片驗證碼，因此 `login()` 的第三個參數是一個 OCR 函數：

```typescript
type Ocr = (dataUrl: string) => Promise<string>;
```

- `dataUrl`：驗證碼圖片，格式為 `data:image/jpeg;base64,...`。
- 回傳值：辨識出的 4 位數字字串。不是 4 位數字時，這次登入會直接回傳失敗。

session 過期時，lib 會用登入時傳入的帳密與 OCR 函數自動重新登入，所以 OCR 函數可能會在之後任何一次 API 呼叫中再被呼叫。

目前的登入流程是依照海大的 CAS 登入頁實作，其他學校的登入頁可能不同。

## 使用說明

此套件是 ES module，請在 ESM 專案中使用：

```javascript
import Tronclass from "tronclass-api";

const tron = new Tronclass();
tron.setBaseUrl("https://tronclass.ntou.edu.tw"); // 你學校的 TronClass 網址
const result = await tron.login("your_username", "your_password", ocrFunction);
if (!result.success) throw new Error(result.message);

const courses = await tron.recentlyVisitedCourses();
console.log(courses);
```

TypeScript 專案可以直接引入型別：

```typescript
import Tronclass, { type Course, type TodoList } from "tronclass-api";
```

## rate limiting
為了避免過於頻繁的請求導致被伺服器封鎖，`Tronclass` 類別內建了一個簡單的 rate limiting 機制。 當請求過於頻繁時，會拋出一個 `RateLimitError`，並且包含一個 `waitTime` 屬性，表示建議等待的時間（毫秒）。 呼叫端可以根據這個資訊來決定何時重新發請求。

```typescript
import Tronclass, { RateLimitError } from "tronclass-api";

try {
  const courses = await tron.recentlyVisitedCourses();
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limit exceeded. Please wait ${error.waitTime} ms before retrying.`);
    // 這裡可以加入等待邏輯，例如使用 setTimeout
  } else {
    // 處理其他錯誤
    console.error("An error occurred:", error);
  }
}
```

預設情況下，rate limiting 設定為每分鐘不超過 60 次請求。 你可以根據需要調整這個限制。

```typescript
tron.fetcherRPM = 200;
```
