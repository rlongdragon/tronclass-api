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

`example/example.js` 使用的 `captcha-nodejs-module` 是作者自己的 OCR 模組，沒有發布在 npm 上。如果你沒有這個模組，把 `login()` 的 OCR 參數拿掉即可（海大支援免驗證碼的 CAS REST 登入，見下方「登入與驗證碼」），然後執行範例：
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

`login()` 會先走 CAS 的 REST 協定（`/cas/v1/tickets`），用帳密換取 ticket 登入，**不需要驗證碼**。海大目前支援這個方式，所以一般情況下只要帳密即可：

```javascript
const result = await tron.login("your_username", "your_password");
```

帳密錯誤時回傳 `reason: "credentials"`，不會再嘗試其他方式。只有 REST 無法使用時，才會改走 CAS 登入頁；登入頁自 2025/10/13 起需要 4 位數字的圖片驗證碼，這時需要第三個參數的 OCR 函數：

```typescript
type Ocr = (dataUrl: string) => Promise<string>;
```

- `dataUrl`：驗證碼圖片，格式為 `data:image/jpeg;base64,...`。
- 回傳值：辨識出的 4 位數字字串。不是 4 位數字時，這次登入會直接回傳失敗；CAS 判定驗證碼錯誤時會換一張重試。

session 過期時，lib 會用同樣的帳密（與 OCR 函數，若有提供）自動重新登入。

目前的登入流程是依照海大的 CAS 登入頁實作，其他學校的登入頁可能不同。

## 使用說明

此套件是 ES module，請在 ESM 專案中使用：

```javascript
import Tronclass from "tronclass-api";

const tron = new Tronclass();
tron.setBaseUrl("https://tronclass.ntou.edu.tw"); // 你學校的 TronClass 網址
const result = await tron.login("your_username", "your_password");
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

## API 資料來源

TronClass 沒有公開的 API 文件。本專案的 endpoint 與參數整理自以下來源，再用海大帳號在 `tronclass.ntou.edu.tw` 實測確認；僅參考 endpoint 與流程，沒有複製程式碼。

| 來源 | 參考內容 |
|---|---|
| [silvercow002/tronclass-script](https://github.com/silvercow002/tronclass-script) | 海大 CAS 登入流程、最近瀏覽課程 |
| [seven-317/Tronclass-API](https://github.com/seven-317/Tronclass-API)（MIT） | 學期、課程、章節、公告、教材、考試成績的 endpoint；API 回應檢查、自動翻頁、下載檔名解析的做法 |
| [RX5950XT/FJU-TronClass-MCP](https://github.com/RX5950XT/FJU-TronClass-MCP) | 個人資料、課程公告、分組、作業上傳與存草稿流程 |
| [andyching168/tronclass_control](https://github.com/andyching168/tronclass_control) | 個人資料、通知（`/ntf`）與通知類型、作業繳交紀錄 |
| [GGQQmax/iclass-mcp](https://github.com/GGQQmax/iclass-mcp) | 跨課程公告（`/api/course-bulletins`）、附件下載、討論區 |
| [eWloYW8/zju-courses-go-sdk](https://github.com/eWloYW8/zju-courses-go-sdk) | 通知、繳交紀錄、分組、成績等 endpoint 目錄 |
| [8eoyw/zju-learning-cli](https://github.com/8eoyw/zju-learning-cli) | 附件下載、預覽 PDF、討論區分頁 |
| [TW-RF54732/tronclass-calender](https://github.com/TW-RF54732/tronclass-calender) | 課程活動、考試列表 |
| [yd-tw/ind-hackathon](https://github.com/yd-tw/ind-hackathon) | 海大的 `my-courses` 參數與待辦事項 |
| [BobLiu0518/TronClass-Resource-Download](https://github.com/BobLiu0518/TronClass-Resource-Download) | 文件預覽網址 |
| 海大 TronClass 公開的前端程式（`tronclass.ntou.edu.tw/static`） | 作業上傳、存草稿／繳交、撤回、分組作業繳交紀錄的請求格式 |

驗證狀態（2026-10-12）：唯讀的 API 都已在海大實測；`uploadFile`、`saveSubmission`、`retractSubmission`、`deleteUpload` 只用 mock 測試過；`getTopic` 因為沒有討論區主題可測，尚未實測。
