import fetchCookie from "fetch-cookie";
import {
  AcademicYear,
  Activity,
  Bulletin,
  BulletinQuery,
  Course,
  CourseModule,
  DownloadedFile,
  Exam,
  ExamScore,
  Group,
  GroupSet,
  HomeworkActivity,
  loginResponse,
  NotificationList,
  Profile,
  Semester,
  Submission,
  SubmissionResult,
  TodoList,
  Topic,
  TopicCategory,
  CreatedUpload,
} from "./types/index.js";
export * from "./types/index.js"; // 導出 src/types/index.ts 中的所有型別
import { CookieJar } from "tough-cookie";
import { JSDOM } from "jsdom";

// 速率限制需要等待超過 rateLimitMaxWaitMs 時拋出，並攜帶可程式存取的等待時間 (ms)
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
  // 送出請求的時間點（performance.now()，不受系統時間調整影響）
  private fetcherUsedHistory: number[] = [];
  public fetcherRPM: number = 60; // 每分鐘請求數
  // 超過速率限制時最多等待多久（ms），需要等更久就拋出 RateLimitError
  public rateLimitMaxWaitMs: number = Infinity;

  constructor() {
    this.jar = new CookieJar();

    this.fetcher = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      await this.waitForRateLimit();
      return fetchCookie(fetch, this.jar)(input, init);
    };
  }

  // 超過每分鐘請求數時，等到最舊的一筆請求滿 60 秒再送出
  private async waitForRateLimit(): Promise<void> {
    for (;;) {
      const now = performance.now();
      this.fetcherUsedHistory = this.fetcherUsedHistory.filter(
        (timestamp) => now - timestamp < 60000
      );
      if (this.fetcherUsedHistory.length < this.fetcherRPM) {
        this.fetcherUsedHistory.push(now);
        return;
      }
      const waitTime = 60000 - (now - this.fetcherUsedHistory[0]);
      if (waitTime > this.rateLimitMaxWaitMs) {
        throw new RateLimitError(waitTime);
      }
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * 登入。先走 CAS REST（不需要驗證碼）；REST 無法使用時才改走登入表單，
   * 這時需要 ocr 辨識驗證碼。
   */
  public async login(
    username: string,
    password: string,
    ocr?: (dataUrl: string) => Promise<string>
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

    this.ocr = ocr;

    this.username = username;
    this.password = password;
    this.loggedIn = false;
    // 換新的 cookie jar：若舊的 CAS TGC 還有效，CAS 會直接換票導回 TronClass，
    // 不會出現登入表單，導致抓不到 lt
    this.jar = new CookieJar();

    const restResult = await this.restLogin(username, password);
    if (restResult) return restResult;

    if (!ocr) {
      return {
        success: false,
        message:
          "CAS REST login is unavailable and no OCR function was provided to solve the captcha.",
      };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // 第一步：發送 GET 請求獲取登入頁面，解析出 CSRF token (lt)
        const response = await this.fetcher(
          `${this.baseUrl}/login?next=/user/index`
        );
        const text = await response.text();

        // cas baseurl：登入頁被導到的 CAS 主機
        const casBaseUrl = new URL(response.url).origin;

        const dom = new JSDOM(text);
        // 使用可選鏈操作符 `?.` 安全地獲取值，並檢查其是否存在
        const lt = (
          dom.window.document.querySelector(
            'input[name="lt"]'
          ) as HTMLInputElement | null
        )?.value;
        const execution =
          (
            dom.window.document.querySelector(
              'input[name="execution"]'
            ) as HTMLInputElement | null
          )?.value ?? "e1s1";

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
            reason: "captcha",
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
          execution,
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
          // CAS 把錯誤原因放在 #msg，例如「驗證碼不正確」
          const casMessage = new JSDOM(loginText).window.document
            .querySelector("#msg")
            ?.textContent?.trim();
          const captchaWrong = /驗證碼|验证码|captcha/i.test(casMessage ?? "");
          // 驗證碼錯誤時換一張重試（OCR 偶爾會讀錯）
          if (captchaWrong && attempt < 2) {
            console.warn(`Incorrect captcha (attempt ${attempt + 1}). Retrying...`);
            continue;
          }
          return {
            success: false,
            message: captchaWrong
              ? "Incorrect captcha."
              : casMessage || "Invalid username or password.",
            reason: captchaWrong ? "captcha" : "credentials",
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

  /**
   * CAS REST 協定登入：帳密換 TGT，再換 TronClass 的 service ticket，不需要驗證碼。
   * 回傳 undefined 表示 REST 無法使用，由呼叫端改走登入表單。
   */
  private async restLogin(
    username: string,
    password: string
  ): Promise<loginResponse | undefined> {
    try {
      // 登入頁會被導到 CAS，藉此取得 CAS 主機
      const page = await this.fetcher(`${this.baseUrl}/login?next=/user/index`);
      await page.body?.cancel();
      const casOrigin = new URL(page.url).origin;

      const tgt = await this.fetcher(`${casOrigin}/cas/v1/tickets`, {
        method: "POST",
        body: new URLSearchParams({ username, password }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      await tgt.body?.cancel();
      if ([400, 401, 403].includes(tgt.status)) {
        return {
          success: false,
          message: "Invalid username or password.",
          reason: "credentials",
        };
      }
      const location = tgt.headers.get("location");
      if (tgt.status !== 201 || !location) return undefined;

      // CAS 回傳的 TGT 網址可能是 http，沿用 CAS 本身的協定
      const tgtUrl = new URL(location);
      tgtUrl.protocol = new URL(casOrigin).protocol;
      const service = `${this.baseUrl}/api/cas-login`;
      const st = await this.fetcher(tgtUrl.toString(), {
        method: "POST",
        body: new URLSearchParams({ service }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const ticket = (await st.text()).trim();
      if (!st.ok || !ticket.startsWith("ST-")) return undefined;

      const session = await this.fetcher(
        `${service}?ticket=${encodeURIComponent(ticket)}`
      );
      await session.body?.cancel();
      if (!session.ok || new URL(session.url).pathname.startsWith("/cas/")) {
        return undefined;
      }

      this.loggedIn = true;
      // 函式庫不寫 stdout，stdout 留給呼叫端使用
      console.error(`Login successful for user: ${username} (CAS REST)`);
      return { success: true, message: "Login successful." };
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      console.warn(
        `CAS REST login failed, falling back to the login form: ${
          e instanceof Error ? e.message : e
        }`
      );
      return undefined;
    }
  }

  // 檢查是否已儲存憑證，有的話重新登入
  private async reAuthenticate(): Promise<void> {
    if (!this.username || !this.password) {
      throw new Error(
        "Not logged in and no credentials saved for re-authentication. Please call the login method first."
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

  /** 呼叫 API 並解析 JSON；非 2xx 或回應不是 JSON 時拋出 ApiError */
  private async requestJson<T = any>(
    endpoint: string,
    config: RequestInit = {}
  ): Promise<T> {
    const res = await this.call(endpoint, config);
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("json")) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, endpoint, body);
    }
    return res.json() as Promise<T>;
  }

  private sendJson<T = any>(
    method: "POST" | "PUT",
    endpoint: string,
    body: unknown
  ): Promise<T> {
    return this.requestJson<T>(endpoint, {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  /** 依 page / pages 翻完所有頁，key 為回應中放資料陣列的欄位 */
  private async getAllPages<T>(
    endpoint: string,
    key: string,
    params: QueryParams = {},
    pageSize = 100
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.requestJson(
        endpoint + query({ ...params, page, page_size: pageSize })
      );
      const batch: T[] = res[key] ?? [];
      items.push(...batch);
      if (batch.length === 0 || !res.pages || page >= res.pages) break;
      if (page === MAX_PAGES) {
        console.warn(
          `${endpoint}: stopped at ${MAX_PAGES} of ${res.pages} pages; results are incomplete.`
        );
      }
    }
    return items;
  }

  ///////////// API /////////////

  // ---- 使用者 ----

  public profile(): Promise<Profile> {
    return this.requestJson("/api/profile");
  }

  public async mySemesters(): Promise<Semester[]> {
    const res = await this.requestJson("/api/my-semesters");
    return res.semesters;
  }

  public async myAcademicYears(): Promise<AcademicYear[]> {
    const res = await this.requestJson("/api/my-academic-years");
    return res.academic_years;
  }

  // ---- 課程 ----

  public recentlyVisitedCourses() {
    return this.requestJson("/api/user/recently-visited-courses");
  }

  /**
   * 我的課程。conditions 例如 { status: ["ongoing"] } 只取進行中的課程；
   * fields 為 TronClass 的欄位選擇語法，例如 "id,name,instructors(id,name)"。
   */
  public myCourses(
    conditions: object = {},
    fields?: string | null,
    showScorePassedStatus: boolean = false
  ): Promise<Course[]> {
    return this.getAllPages("/api/my-courses", "courses", {
      conditions: Object.keys(conditions).length ? conditions : undefined,
      fields,
      showScorePassedStatus: showScorePassedStatus || undefined,
    });
  }

  public getCourse(courseId: number): Promise<Course> {
    return this.requestJson(`/api/courses/${courseId}`);
  }

  /** 課程的週次／章節 */
  public async getCourseModules(courseId: number): Promise<CourseModule[]> {
    const res = await this.requestJson(`/api/courses/${courseId}/modules`);
    return res.modules;
  }

  // ---- 待辦 ----

  public async todos(): Promise<TodoList[]> {
    const res = await this.requestJson("/api/todos");
    return res.todo_list;
  }

  // ---- 公告與通知 ----

  /** 課程公告（預設為我所有課程）；日期格式為 YYYY-MM-DD，留空表示不限 */
  public async courseBulletins(
    options: BulletinQuery & { page?: number; pageSize?: number } = {}
  ): Promise<Bulletin[]> {
    const { page = 1, pageSize = 20, ...filters } = options;
    const res = await this.requestJson(
      "/api/course-bulletins" +
        query({
          conditions: bulletinConditions(filters),
          page,
          page_size: pageSize,
        })
    );
    return res.bulletins;
  }

  public async getCourseBulletins(
    courseId: number,
    options: BulletinQuery = {}
  ): Promise<Bulletin[]> {
    const res = await this.requestJson(
      `/api/courses/${courseId}/bulletins` +
        query({ conditions: bulletinConditions(options) })
    );
    return res.bulletins;
  }

  /** 全校公告 */
  public async orgBulletins(page = 1, pageSize = 20): Promise<Bulletin[]> {
    const res = await this.requestJson(
      "/api/org-bulletin/bulletins" +
        query({ page, page_size: pageSize, conditions: {} })
    );
    return res.bulletins;
  }

  /** 通知；userId 可從 profile().id 取得，types 例如 ["homework_expiring"] */
  public notifications(
    userId: number,
    options: { offset?: number; limit?: number; types?: string[] } = {}
  ): Promise<NotificationList> {
    const { offset = 0, limit = 20, types = [] } = options;
    const typeParams = types
      .map((t) => `&types=${encodeURIComponent(t)}`)
      .join("");
    return this.requestJson(
      `/ntf/users/${userId}/notifications` +
        query({ offset, limit, additionalFields: "unread_count" }) +
        typeParams
    );
  }

  // ---- 學習活動、教材與下載 ----

  /** 課程內所有學習活動（教材、作業、影片、連結等），附件在 uploads */
  public async getCourseActivities(courseId: number): Promise<Activity[]> {
    const res = await this.requestJson(
      `/api/courses/${courseId}/activities?sub_course_id=0`
    );
    return res.activities;
  }

  public getActivity(activityId: number): Promise<Activity> {
    return this.requestJson(`/api/activities/${activityId}?sub_course_id=0`);
  }

  /** 下載附件；referenceId 為 activity.uploads[].reference_id */
  public async downloadUpload(referenceId: number): Promise<DownloadedFile> {
    const res = await this.call(`/api/uploads/reference/${referenceId}/blob`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, `/api/uploads/reference/${referenceId}/blob`, body);
    }

    return {
      filename: parseFilename(res.headers.get("content-disposition")),
      contentType:
        res.headers.get("content-type") ?? "application/octet-stream",
      data: Buffer.from(await res.arrayBuffer()),
    };
  }

  /** 文件轉成 PDF 的預覽網址（有時效）；allow_download 為 false 時也能取得 */
  public async getUploadPreviewUrl(referenceId: number): Promise<string> {
    const res = await this.requestJson(
      `/api/uploads/reference/document/${referenceId}/url?preview=true`
    );
    return res.url;
  }

  // ---- 作業 ----

  public getHomeworkActivitiesByCourseId(
    courseId: number
  ): Promise<HomeworkActivity[]> {
    return this.getAllPages(
      `/api/courses/${courseId}/homework-activities`,
      "homework_activities"
    );
  }

  /** 我在某份作業的歷次繳交（含草稿、分數與老師評語）；userId 可從 profile().id 取得 */
  public async getSubmissionList(
    activityId: number,
    userId: number
  ): Promise<Submission[]> {
    const res = await this.requestJson(
      `/api/activities/${activityId}/students/${userId}/submission_list`
    );
    return res.list;
  }

  /**
   * 上傳檔案供繳交作業使用，回傳的 id 放進 saveSubmission 的 uploadIds。
   * 檔案本體直接送到 upload_url（可能是另一台主機，網址本身帶 token），不帶 TronClass 的 cookie。
   */
  public async uploadFile(
    name: string,
    data: Buffer,
    contentType = "application/octet-stream"
  ): Promise<CreatedUpload> {
    const upload = await this.sendJson<CreatedUpload>("POST", "/api/uploads", {
      name,
      size: data.length,
      parent_type: null,
      parent_id: 0,
      is_scorm: false,
      is_wmpkg: false,
      source: "",
      is_marked_attachment: false,
      embed_material_type: "",
    });
    if (!upload.upload_url) {
      throw new Error("Upload record has no upload_url.");
    }
    // upload_url 也可能是相對路徑
    const uploadUrl = new URL(upload.upload_url, this.baseUrl).toString();

    try {
      let res: Response;
      if (upload.storage_type === "S3" && upload.transcoder === "WRPC") {
        res = await fetch(uploadUrl, {
          method: "PUT",
          body: new Uint8Array(data),
          headers: { "Content-Type": contentType },
        });
        if (res.ok) {
          // callback 的回應內容不重要，只看是否成功
          res = await this.call(`/internal-api/upload/callback/${upload.id}`, {
            method: "POST",
            body: JSON.stringify({ file_key: upload.id }),
            headers: { "Content-Type": "application/json" },
          });
        }
      } else if (upload.storage_type === "QINIU") {
        throw new Error("QINIU storage is not supported.");
      } else {
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(data)], { type: contentType }),
          name
        );
        res = await fetch(uploadUrl, { method: "PUT", body: form });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ApiError(res.status, "upload_url", body);
      }
      await res.body?.cancel();
    } catch (e) {
      // 上傳紀錄會留在「我的資源」，失敗時盡量刪掉
      await this.deleteUpload(upload.id).catch(() => {});
      throw e;
    }
    return upload;
  }

  /** 刪除上傳的檔案（例如存草稿前上傳失敗或不再需要的檔案） */
  public async deleteUpload(uploadId: number): Promise<void> {
    const endpoint = `/api/uploads/${uploadId}`;
    const res = await this.call(endpoint, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, endpoint, body);
    }
    await res.body?.cancel();
  }

  /**
   * 存草稿或正式繳交作業。已有草稿時傳入 submissionId 以覆蓋該草稿；
   * isDraft 為 false 即正式繳交（之後只能透過 retractSubmission 撤回）。
   */
  public saveSubmission(
    activityId: number,
    options: {
      uploadIds: number[];
      comment?: string;
      isDraft: boolean;
      submissionId?: number;
      /** activity.data.mode，預設 normal */
      mode?: string;
      /** mode 為 multiple 時必填：選擇的題目（activity.data.multiple_choice[].title） */
      multipleChoiceTitle?: string;
    }
  ): Promise<SubmissionResult> {
    const {
      uploadIds,
      comment = "",
      isDraft,
      submissionId,
      mode = "normal",
      multipleChoiceTitle,
    } = options;
    return this.sendJson(
      submissionId ? "PUT" : "POST",
      `/api/course/activities/${activityId}/submissions`,
      {
        comment,
        uploads: uploadIds,
        slides: [],
        is_draft: isDraft,
        mode,
        other_resources: [],
        uploads_in_rich_text: [],
        ...(submissionId && { submission_id: submissionId }),
        ...(mode === "multiple" && {
          multiple_choice_title: multipleChoiceTitle,
        }),
      }
    );
  }

  /** 撤回已繳交的作業（作業需允許撤回），撤回後會變回草稿 */
  public async retractSubmission(submissionId: number): Promise<void> {
    const endpoint = `/api/submissions/${submissionId}/retract`;
    const res = await this.call(endpoint, { method: "PUT" });
    const body = await res.text().catch(() => "");
    // 失敗時可能是 HTTP 200 但內容為 {code: 40001}
    let code: unknown;
    try {
      code = JSON.parse(body)?.code;
    } catch {}
    if (!res.ok || (typeof code === "number" && code >= 40000)) {
      throw new ApiError(res.status, endpoint, body);
    }
  }

  // ---- 分組 ----

  /** 課程的分組集合；學生在 groups 只會看到自己所在的組 */
  public async getCourseGroupSets(courseId: number): Promise<GroupSet[]> {
    const res = await this.requestJson(`/api/courses/${courseId}/group-sets`);
    return res.group_sets;
  }

  /** 我在某個分組集合中的組別（含組員）；groupSetId 也可從作業的 group_set_id 取得 */
  public async getMyGroup(groupSetId: number): Promise<Group> {
    const res = await this.requestJson(`/api/group-sets/${groupSetId}/group`);
    return res.group;
  }

  /** 分組作業中某組的歷次繳交（含草稿） */
  public async getGroupSubmissionList(
    activityId: number,
    groupId: number
  ): Promise<Submission[]> {
    const res = await this.requestJson(
      `/api/activities/${activityId}/groups/${groupId}/submission_list`
    );
    return res.list;
  }

  // ---- 考試與成績（唯讀） ----

  public getExamList(courseId: number): Promise<Exam[]> {
    return this.getAllPages(`/api/courses/${courseId}/exam-list`, "exams");
  }

  public async getExamScores(courseId: number): Promise<ExamScore[]> {
    const res = await this.requestJson(`/api/courses/${courseId}/exam-scores`);
    return res.exam_scores;
  }

  // ---- 討論區 ----

  /** 討論區分類；討論區活動的 topic_category_id 對應這裡的 id */
  public async getTopicCategories(courseId: number): Promise<TopicCategory[]> {
    const res = await this.requestJson(
      `/api/courses/${courseId}/topic-categories`
    );
    return res.topic_categories;
  }

  public async getForumTopics(
    categoryId: number,
    page = 1,
    pageSize = 50
  ): Promise<Topic[]> {
    const res = await this.requestJson(
      `/api/forum/categories/${categoryId}` +
        query({ page, page_size: pageSize })
    );
    return res.result?.topics ?? [];
  }

  /** 單一主題與回覆 */
  public getTopic(topicId: number): Promise<Topic> {
    return this.requestJson(`/api/topics/${topicId}`);
  }
}

/** API 回應不是 2xx，或預期 JSON 卻拿到別的內容 */
export class ApiError extends Error {
  status: number;
  endpoint: string;
  body: string;
  constructor(status: number, endpoint: string, body: string) {
    super(`API ${endpoint} failed: ${status} ${body.slice(0, 200)}`);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// 分頁的上限，避免回應的 pages 不正確時無限翻頁
const MAX_PAGES = 50;

type QueryParams = Record<
  string,
  string | number | boolean | object | null | undefined
>;

// 組 query string；物件（例如 conditions）以 JSON 編碼，null / undefined 略過
function query(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    search.set(
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value)
    );
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

function bulletinConditions(options: BulletinQuery) {
  return {
    start_date: options.startDate ?? "",
    end_date: options.endDate ?? "",
    keyword: options.keyword ?? "",
    ...(options.courseIds && { course_ids: options.courseIds }),
  };
}

// 取出 Content-Disposition 的檔名：優先用 RFC 5987 的 filename*，否則用 filename。
// 伺服器若直接送 UTF-8 位元組，fetch 會以 latin1 解讀，需轉回 UTF-8。
function parseFilename(disposition: string | null): string | undefined {
  if (!disposition) return undefined;

  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encoded) return decodeURIComponent(encoded[1].trim());

  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (!plain) return undefined;
  const name = plain[1].trim();
  return /[\u0080-ÿ]/.test(name)
    ? Buffer.from(name, "latin1").toString("utf8")
    : name;
}

export default TronClass;
