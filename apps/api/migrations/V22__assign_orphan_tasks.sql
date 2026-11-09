-- Ma'lumot tuzatish: mijozga buxgalter vazifalar yaratilgandan keyin qo'yilgan bo'lsa, ochiq vazifalar
-- biriktirilmagan qolib ketgan edi (reassignOpenTasks faqat assignee_id IS NOT NULL'larni ko'chirardi).
-- Endi ular mijoz buxgalteriga o'tadi; creates_accountant_task = false hisobotlar ataylab bo'sh qoladi.
WITH fixed AS (
  UPDATE task t SET assignee_id = c.accountant_id
  FROM client c
  WHERE c.id = t.client_id
    AND c.accountant_id IS NOT NULL
    AND t.assignee_id IS NULL
    AND t.status IN ('TODO', 'IN_PROGRESS', 'WAITING_CLIENT')
    AND (t.kind <> 'REPORT' OR EXISTS (
      SELECT 1 FROM report_type rt WHERE rt.id = t.report_type_id AND rt.creates_accountant_task
    ))
  RETURNING t.id, t.client_id, t.assignee_id
)
INSERT INTO audit_log (actor_id, entity, entity_id, client_id, action, before, after)
SELECT NULL, 'task', id::text, client_id, 'REASSIGN', '{"assigneeId": null}'::jsonb, jsonb_build_object('assigneeId', assignee_id)
FROM fixed;
