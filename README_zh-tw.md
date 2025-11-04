[English](./README.md) | 中文

# tronclass API

一個非官方的 TronClass（tronclass.com）API 工具庫，封裝登入、會話維護與常用 API 呼叫，方便在 Node.js / TypeScript 專案中自動化存取 TronClass 的使用者資料與課程資訊。
> 腳本來源 [@silvercow002/tronclass-script](https://github.com/silvercow002/tronclass-script)

## 主要功能

- 使用 cookie jar 自動處理登入後的 session。
- 解析登入頁面以抓取 CSRF token（lt）並完成表單登入。
- 自動重試與簡單的錯誤處理機制。
- 提供簡單的包裝方法（例如 `recentlyVisitedCourses`）與通用的 `call` 方法以呼叫任意 API endpoint。

## 目錄

- `src/` - TypeScript 原始碼。
- `dist/` - 編譯後的 JavaScript（若已 build）。
- `example/` - 使用範例（`example/example.js`）。

## 快速開始

clone 此專案後
```bash
npm install
npm run build
```

在 `example/example.js` 中填入你的 TronClass 帳號密碼，然後執行範例：
```bash
npm run example
```

## 使用說明
因為此專案還沒上傳到 npm，你可以直接從本地路徑引入：

你可以先在其他資料夾建立一個新的 Node.js 專案，然後在 `package.json` 中加入以下依賴（請將路徑改成你本地的絕對路徑）：

因海大的 tronclass 在 2025/10/13 登入畫面加入了 reCAPTCHA，故更新 OCR 辨識文字功能。
你需要在登入的函數裡面添加 OCR 的參數，並且傳入一個能夠辨識圖片文字的函數。
如果你不需要 OCR ，可以參考此前版本 index.ts 的 login 函數。

```json
{
  "dependencies": {
    "tronclass-api": "file:/absolute/path/to/tronclass-api"
  } 
}
```

然後在你的程式碼中這樣使用：

```javascript
import { Tronclass } from "tronclass-api";

(async () => {
  const tron = new Tronclass();
  const tron.setBaseUrl("https://tronclass.com"); // 你學校的 TronClass 網址
  await tron.login("your_username", "your_password", ocrFunction);
  const courses = await tron.recentlyVisitedCourses();
  console.log(courses);
})();
```

## rate limiting
為了避免過於頻繁的請求導致被伺服器封鎖，`Tronclass` 類別內建了一個簡單的 rate limiting 機制。 當請求過於頻繁時，會拋出一個 `RateLimitError`，並且包含一個 `waitTime` 屬性，表示建議等待的時間（毫秒）。 呼叫端可以根據這個資訊來決定何時重新發請求。

```typescript
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
tronclass.fetcherRPM = 200;
```
