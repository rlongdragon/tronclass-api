// 回應欄位整理自海大實測與其他學校的開源 TronClass client。
// 標註「海大實測」的型別欄位已在 tronclass.ntou.edu.tw 確認，其餘只列出已知欄位並保留 index signature。

export interface loginResponse {
  success: boolean;
  message: string;
  /** 失敗原因：驗證碼錯誤或帳密錯誤（CAS 的 #msg） */
  reason?: "captcha" | "credentials";
}

/** GET /api/profile（海大實測） */
export interface Profile {
  id: number;
  name: string;
  user_no?: string;
  email?: string;
  department?: { id?: number; name?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Semester {
  id: number;
  name: string;
  real_name?: string;
  academic_year_id?: number;
  is_active?: boolean;
  [key: string]: unknown;
}

export interface AcademicYear {
  id: number;
  name: string;
  is_active?: boolean;
  [key: string]: unknown;
}

/** GET /api/todos 的 todo_list 項目（id 為 activity id；海大實測） */
export interface TodoList {
  id: number;
  title: string;
  type?: string;
  course_id?: number;
  course_name?: string;
  course_code?: string;
  course_type?: number | string;
  start_time?: string | null;
  end_time?: string | null;
  is_locked?: boolean;
  is_student?: boolean;
  prerequisites?: unknown[];
  [key: string]: unknown;
}

/** GET /api/my-courses 的 courses 項目（海大實測） */
export interface Course {
  id: number;
  name: string;
  course_code?: string;
  course_type?: number | string;
  credit?: string | number | null;
  compulsory?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  academic_year?: { id: number; name: string; [key: string]: unknown } | null;
  semester?: { id: number; name: string; [key: string]: unknown } | null;
  department?: { id: number; name: string; [key: string]: unknown } | null;
  instructors?: { id: number; name: string; [key: string]: unknown }[];
  /** @deprecated 海大不回傳，改用 academic_year / semester 物件 */
  academic_year_id?: number;
  /** @deprecated 海大不回傳，改用 academic_year / semester 物件 */
  semester_id?: number;
  /** @deprecated 海大的 my-courses 不回傳（getCourse 才有） */
  display_name?: string;
  /** @deprecated 海大不回傳 */
  is_closed?: boolean;
  [key: string]: unknown;
}

/** GET /api/courses/{id}/modules 的 modules 項目（海大實測） */
export interface CourseModule {
  id: number;
  name: string;
  sort?: number;
  is_hidden?: boolean;
  [key: string]: unknown;
}

/** GET /api/courses/{id}/homework-activities 的 homework_activities 項目 */
export interface HomeworkActivity {
  id: number;
  title: string;
  start_time?: string | null;
  end_time?: string | null;
  score?: number | string | null;
  score_published?: boolean;
  submitted?: boolean;
  uploads?: Upload[];
  [key: string]: unknown;
}

/** activity.uploads[] 的附件（海大實測） */
export interface Upload {
  id: number;
  name: string;
  /** 下載用的 ID（downloadUpload / getUploadPreviewUrl） */
  reference_id: number;
  size?: number;
  type?: string;
  allow_download?: boolean;
  status?: string;
  [key: string]: unknown;
}

/** uploadFile 的回傳：剛建立的上傳紀錄，id 用於 saveSubmission 的 uploadIds */
export interface CreatedUpload {
  id: number;
  name: string;
  size?: number;
  status?: string;
  /** 檔案本體要送往的網址與儲存方式 */
  upload_url?: string;
  storage_type?: string;
  transcoder?: string;
  [key: string]: unknown;
}

/** GET /api/courses/{id}/activities 的 activities 項目（海大實測） */
export interface Activity {
  id: number;
  title: string;
  /** material、homework、online_video、web_link 等 */
  type: string;
  course_id?: number;
  start_time?: string | null;
  end_time?: string | null;
  is_closed?: boolean;
  is_in_progress?: boolean;
  submit_by_group?: boolean;
  /** 分組作業的分組集合（getMyGroup 用）；非分組作業為 0 */
  group_set_id?: number;
  group_set_name?: string;
  data?: {
    description?: string;
    mode?: string;
    submit_times?: number;
    allow_retract?: boolean;
    [key: string]: unknown;
  };
  uploads?: Upload[];
  [key: string]: unknown;
}

export interface DownloadedFile {
  /** 取自 Content-Disposition，伺服器沒給時為 undefined */
  filename?: string;
  contentType: string;
  data: Buffer;
}

/** submission_list 的項目：一次繳交或草稿 */
export interface Submission {
  id: number;
  comment?: string;
  uploads?: Upload[];
  created_at?: string | null;
  submitted_at?: string | null;
  is_draft?: boolean;
  is_latest_version?: boolean;
  can_retract?: boolean;
  score?: number | string | null;
  final_score?: number | string | null;
  instructor_comment?: string | null;
  [key: string]: unknown;
}

/** saveSubmission 的回應 */
export interface SubmissionResult {
  submission?: Submission;
  message?: string;
  [key: string]: unknown;
}

export interface BulletinQuery {
  courseIds?: number[];
  keyword?: string;
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD */
  endDate?: string;
}

/** 課程公告與全校公告；content 為 HTML（海大實測） */
export interface Bulletin {
  id: number;
  title: string;
  content?: string;
  course_id?: number;
  created_at?: string;
  created_by?: { id?: number; name?: string; [key: string]: unknown };
  uploads?: Upload[];
  [key: string]: unknown;
}

export interface NotificationItem {
  id: string | number;
  type: string;
  unread?: boolean;
  timestamp?: number | string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

/** GET /ntf/users/{id}/notifications（海大實測，沒有 total_count） */
export interface NotificationList {
  notifications: NotificationItem[];
  unread_count?: number;
  total_count?: number;
  [key: string]: unknown;
}

export interface Exam {
  id: number;
  title: string;
  start_time?: string | null;
  end_time?: string | null;
  [key: string]: unknown;
}

export interface ExamScore {
  activity_id: number;
  score?: number | string | null;
  [key: string]: unknown;
}

export interface TopicCategory {
  id: number;
  title?: string;
  activity_id?: number;
  [key: string]: unknown;
}

export interface Topic {
  id: number;
  title: string;
  content?: string;
  created_at?: string;
  created_by?: { id?: number; name?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** 分組集合中的一組（海大實測） */
export interface Group {
  id: number;
  name: string;
  group_set_id?: number;
  /** 組長的 user id */
  leaders?: number[];
  /** 組員的 user id */
  members?: number[];
  /** getMyGroup 才有：組員的姓名與學號 */
  group_users?: { id: number; name: string; user_no?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** GET /api/courses/{id}/group-sets 的 group_sets 項目（海大實測） */
export interface GroupSet {
  id: number;
  name: string;
  course_id?: number;
  group_count?: number;
  /** 學生只會看到自己所在的組 */
  groups?: Group[];
  [key: string]: unknown;
}
