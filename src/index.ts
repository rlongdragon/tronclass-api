import fetchCookie from "fetch-cookie";
import {
  Course,
  HomeworkActivity,
  loginResponse,
  TodoList,
} from "./types/index.js";
export * from "./types/index.js"; // 導出 src/types/index.ts 中的所有型別
import { CookieJar } from "tough-cookie";
import { JSDOM } from "jsdom";

// 自訂錯誤：當達到速率限制時拋出，並攜帶可程式存取的等待時間 (ms)
export class RateLimitError extends Error {
  waitTime: number;
  constructor(waitTime: number, message?: string) {
    super(message ?? `Rate limit exceeded. Please wait ${waitTime} ms.`);
    this.name = "RateLimitError";
    this.waitTime = waitTime;
    // 修正 prototype 鏈以支援 instanceof 在 TS/ES5 環境
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

class TronClass {
  baseUrl: string | undefined;
  private username: string | undefined;
  private password: string | undefined;
  private jar: CookieJar;
  private fetcher: typeof fetch;
  private loggedIn: boolean = false;
  private ocr: ((dataUrl: string) => Promise<string>) | undefined;
  private fetcherUsedHistory: Date[] = [];
  public fetcherRPM: number = 60; // 每分鐘請求數

  constructor() {
    this.jar = new CookieJar();

    this.fetcher = (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const rateLimit = this.rateLimiter();
      if (!rateLimit.ok) {
        throw new RateLimitError(rateLimit.waitTime ?? 0);
      }
      return fetchCookie(fetch, this.jar)(input, init);
    };
  }

  private rateLimiter() {
    const now = new Date();
    this.fetcherUsedHistory = this.fetcherUsedHistory.filter(
      (timestamp) => now.getTime() - timestamp.getTime() < 60000
    );
    if (this.fetcherUsedHistory.length >= this.fetcherRPM) {
      const waitTime =
        60000 - (now.getTime() - this.fetcherUsedHistory[0].getTime());
      return { ok: false, waitTime };
    }
    this.fetcherUsedHistory.push(now);
    return { ok: true };
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  public async login(
    username: string,
    password: string,
    ocr: (dataUrl: string) => Promise<string>
  ): Promise<loginResponse> {
    if (!username || !password) {
      return {
        success: false,
        message: "Username and password must be provided.",
      };
    }
    if (!this.baseUrl) {
      return {
        success: false,
        message: "Base URL is not set. Please call setBaseUrl first.",
      };
    }
    if (!ocr) {
      return {
        success: false,
        message: "OCR function must be provided to solve captcha.",
      };
    }

    this.ocr = ocr;

    this.username = username;
    this.password = password;
    this.loggedIn = false;
    // 換新的 cookie jar：若舊的 CAS TGC 還有效，CAS 會直接換票導回 TronClass，
    // 不會出現登入表單，導致抓不到 lt
    this.jar = new CookieJar();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // 第一步：發送 GET 請求獲取登入頁面，解析出 CSRF token (lt)
        const response = await this.fetcher(
          `${this.baseUrl}/login?next=/user/index`
        );
        const text = await response.text();

        const responseUrl = response.url;
        // cas baseurl
        const casBaseUrl = responseUrl.split(".tw/")[0] + ".tw";

        const dom = new JSDOM(text);
        // 使用可選鏈操作符 `?.` 安全地獲取值，並檢查其是否存在
        const lt = (
          dom.window.document.querySelector(
            'input[name="lt"]'
          ) as HTMLInputElement | null
        )?.value;

        // get captcha image data URL
        const imgRes = await this.fetcher(`${casBaseUrl}/cas/captcha.jpg?`);
        const arrayBuffer = await imgRes.arrayBuffer();
        const imgBuffer = Buffer.from(arrayBuffer);
        const base64Image = imgBuffer.toString("base64");

        const contentType = imgRes.headers.get("Content-Type");
        if (!contentType || !contentType.startsWith("image/")) {
          throw new Error("Captcha image not found or invalid content type.");
        }
        const dataUrl = `data:image/jpeg;base64,${base64Image}`;

        const captchaCode = await ocr(dataUrl);

        // Check if captcha code is valid (4 digits)
        if (!/^\d{4}$/.test(captchaCode)) {
          console.error("Invalid captcha code. Must be 4 digits.");
          return {
            success: false,
            message: "Invalid captcha code. Must be 4 digits.",
          };
        }

        if (!lt) {
          throw new Error(
            "CSRF token 'lt' not found on the login page. Login page structure might have changed or access denied."
          );
        }

        const data = new URLSearchParams({
          username: this.username,
          password: this.password,
          captcha: captchaCode,
          lt: lt,
          execution: "e1s1",
          _eventId: "submit",
          submit: "登錄", // 登入按鈕的文字，可能因網站而異
        });

        const loginResponse = await this.fetcher(
          `${casBaseUrl}/cas/login?next=/user/index`,
          {
            method: "POST",
            body: data,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            redirect: "follow", // 自動跟隨 HTTP 重定向
          }
        );

        const loginText = await loginResponse.text();
        // 判斷登入是否成功的邏輯：如果響應包含 "forget-password" 字串，則認為登入失敗
        if (loginText.includes("forget-password")) {
          return {
            success: false,
            message: "Invalid username or password.",
          };
        }

        this.loggedIn = true;
        // 函式庫不寫 stdout，stdout 留給呼叫端使用
        console.error(`Login successful for user: ${username}`);
        return { success: true, message: "Login successful." };
      } catch (e) {
        console.error(e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (e) {
          // 處理登入憑證無效的錯誤
          if (attempt < 2) {
            console.warn(
              `Login attempt ${
                attempt + 1
              } failed for ${username}: ${errorMessage}. Retrying...`
            );
          } else {
            console.error(
              `Max retries reached! Login failed for ${username}: ${errorMessage}`
            );
            return {
              success: false,
              message: `Login failed after multiple attempts: ${errorMessage}`,
            };
          }
        } else {
          // 處理其他類型的錯誤（例如網路錯誤、JSDOM 解析錯誤等）
          if (attempt < 2) {
            console.error(
              `Login attempt ${
                attempt + 1
              } encountered an error for ${username}: ${errorMessage}. Retrying...`
            );
          } else {
            console.error(
              `Max retries reached! Login failed for ${username} due to an unexpected error: ${errorMessage}`
            );
            return {
              success: false,
              message: `Login failed after multiple attempts due to unexpected error: ${errorMessage}`,
            };
          }
        }
      }
    }
    // 如果迴圈結束後沒有成功返回，提供一個最終的失敗訊息
    return {
      success: false,
      message:
        "Login process completed without success or clear failure message.",
    };
  }

  /**
   * 發送一個經過認證的 API 請求到指定的端點。
   * 會透過內部 fetcher 自動處理 Cookie；偵測到 session 失效時會自動重新登入並重送一次。
   * @param {string} endpoint - 要呼叫的 API 端點 (例如："/user/data")。
   * @param {RequestInit} [config={}] - 可選的 fetch 配置物件。
   * @returns {Promise<Response>} - 原始的 fetch Response 物件。
   * @throws {Error} 如果 baseUrl 未設定、未登入，或重新登入後 session 仍無效。
   */
  public async call(
    endpoint: string,
    config: RequestInit = {}
  ): Promise<Response> {
    if (!this.baseUrl) {
      throw new Error(
        "Base URL is not set. Please set it using setBaseUrl method before making API calls."
      );
    }

    const fullUrl = `${this.baseUrl}${
      endpoint.startsWith("/") ? endpoint : `/${endpoint}`
    }`;

    // 第二輪只會在第一輪偵測到 session 失效、已重新登入後執行
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.loggedIn) {
        await this.reAuthenticate();
      }

      const response = await this.fetcher(fullUrl, config);
      if (!this.isSessionExpired(fullUrl, response)) {
        return response;
      }

      await response.body?.cancel();
      this.loggedIn = false;
      console.warn("Session expired. Re-authenticating...");
    }

    throw new Error(
      "Session is still invalid after re-authentication. Please log in manually."
    );
  }

  // 檢查是否已儲存憑證，有的話重新登入
  private async reAuthenticate(): Promise<void> {
    if (!this.username || !this.password) {
      throw new Error(
        "Not logged in and no credentials saved for re-authentication. Please call the login method first."
      );
    }
    if (!this.ocr) {
      throw new Error(
        "OCR function must be provided to solve captcha during re-authentication."
      );
    }

    console.warn(
      "Session not active or expired. Attempting to re-authenticate automatically..."
    );
    const loginResult = await this.login(
      this.username,
      this.password,
      this.ocr
    );
    if (!loginResult.success) {
      throw new Error(
        `Automatic re-authentication failed: ${loginResult.message}. Please log in manually.`
      );
    }
    console.error("Automatic re-authentication successful.");
  }

  /**
   * 判斷回應是否代表 session 已失效。
   * 海大 TronClass 失效時會 302 到 CAS 登入頁，fetch 跟隨後得到 200 HTML 而非 JSON；
   * 若 CAS 的 TGC 仍有效，則會自動換票並導回 TronClass 網頁（非 API 路徑）。
   */
  private isSessionExpired(requestUrl: string, response: Response): boolean {
    if (response.status === 401) return true;
    if (!response.url) return false;

    const requested = new URL(requestUrl);
    const final = new URL(response.url);
    if (final.pathname.startsWith("/cas/")) return true;

    const isApiPath = (path: string) => /^\/(api|ntf)\//.test(path);
    return (
      isApiPath(requested.pathname) &&
      final.host === requested.host &&
      !isApiPath(final.pathname)
    );
  }

  ///////////// API /////////////
  public recentlyVisitedCourses() {
    return this.call("/api/user/recently-visited-courses").then((res) =>
      res.json()
    );
  }

  public async todos(): Promise<TodoList[]> {
    const res = await this.call("/api/todos").then((res) => res.json());
    return res.todo_list;
  }

  public async myCourses(
    conditions: object,
    fields: any,
    showScorePassedStatus: boolean = false
  ): Promise<Course[]> {
    const res = await this.call("/api/my-courses").then((res) => res.json());

    return res.courses;
  }

  public async getHomeworkActivitiesByCourseId(
    courseId: number
  ): Promise<HomeworkActivity[]> {
    const res = await this.call(
      `api/courses/${courseId}/homework-activities`
    ).then((res) => res.json());

    return res.homework_activities;
  }
}

export default TronClass;
