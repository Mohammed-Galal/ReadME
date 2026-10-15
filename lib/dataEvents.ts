export const COURSE_DATA_CHANGED = 'readme-course-data-changed';
export const COMMENT_DATA_CHANGED = 'readme-comment-data-changed';

export function notifyCourseDataChanged(courseId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COURSE_DATA_CHANGED, { detail: { courseId } }));
  }
}

export function notifyCommentDataChanged(lessonId: string, courseId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COMMENT_DATA_CHANGED, { detail: { lessonId, courseId } }));
  }
}
