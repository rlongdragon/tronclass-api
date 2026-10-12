// 回應欄位整理自其他學校的開源 TronClass client，尚未在海大逐一驗證，
// 因此只列出已知欄位並保留 index signature。

export interface loginResponse {
  success: boolean;
  message: string;
}

/** GET /api/todos 的 todo_list 項目（id 為 activity id） */
export interface TodoList {
  id: number;
  title: string;
  type?: string;
  course_id?: number;
  course_name?: string;
  course_code?: string;
  start_time?: string | null;
  end_time?: string | null;
  is_locked?: boolean;
  [key: string]: unknown;
}

/** GET /api/my-courses 的 courses 項目 */
export interface Course {
  id: number;
  name: string;
  course_code?: string;
  display_name?: string;
  academic_year_id?: number;
  semester_id?: number;
  start_date?: string | null;
  end_date?: string | null;
  is_closed?: boolean;
  credit?: string | number | null;
  instructors?: { id: number; name: string; [key: string]: unknown }[];
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
  uploads?: unknown[];
  [key: string]: unknown;
}
