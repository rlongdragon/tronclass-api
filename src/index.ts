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

        console.log(casBaseUrl);
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
        console.log(`Login successful for user: ${username}`);
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
   * 會透過內部 fetcher 自動處理 Cookie。
   * @param {string} endpoint - 要呼叫的 API 端點 (例如："/user/data")。
   * @param {RequestInit} [config={}] - 可選的 fetch 配置物件。
   * @returns {Promise<Response>} - 原始的 fetch Response 物件。
   * @throws {Error} 如果 baseUrl 未設定或未登入。
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

    // 檢查是否已登入。如果未登入且已儲存憑證，則嘗試自動重新驗證。
    if (!this.loggedIn) {
      if (this.username && this.password) {
        console.warn(
          "Session not active or expired. Attempting to re-authenticate automatically..."
        );
        // TODO: 這裡的 ocr 函數需要從外部傳入，或者有一個預設的處理方式
        // 目前暫時使用一個簡單的同步函數來避免錯誤
        // 這裡應該改成更合適的方式來處理 OCR
        if (!this.ocr) {
          throw new Error(
            "OCR function must be provided to solve captcha during re-authentication."
          );
        }
        const loginResult = await this.login(
          this.username,
          this.password,
          this.ocr!
        );
        if (!loginResult.success) {
          throw new Error(
            `Automatic re-authentication failed: ${loginResult.message}. Please log in manually.`
          );
        }
        console.log("Automatic re-authentication successful.");
      } else {
        throw new Error(
          "Not logged in and no credentials saved for re-authentication. Please call the login method first."
        );
      }
    }

    const fullUrl = `${this.baseUrl}${
      endpoint.startsWith("/") ? endpoint : `/${endpoint}`
    }`;
    const response = await this.fetcher(fullUrl, config);
    return response;
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
