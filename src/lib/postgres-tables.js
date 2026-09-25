// Описание ключей начальной схемы: используется для параметризованных вставок и обновлений.
export const postgresTables = {
 "access_assignments": {
  "columns": [
   "id",
   "role_id",
   "principal_type",
   "principal_id",
   "scope_type",
   "scope_id",
   "valid_from",
   "expires_at",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "role_id",
    "principal_type",
    "principal_id",
    "scope_type",
    "scope_id"
   ]
  ]
 },
 "access_group_members": {
  "columns": [
   "group_id",
   "user_id",
   "membership_source",
   "expires_at",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "group_id",
    "user_id"
   ]
  ]
 },
 "access_groups": {
  "columns": [
   "id",
   "workspace_id",
   "parent_group_id",
   "code",
   "name",
   "description",
   "source",
   "external_key",
   "active",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "code"
   ]
  ]
 },
 "access_role_permissions": {
  "columns": [
   "role_id",
   "permission_key",
   "effect"
  ],
  "identity": null,
  "keys": [
   [
    "role_id",
    "permission_key"
   ]
  ]
 },
 "access_roles": {
  "columns": [
   "id",
   "workspace_id",
   "code",
   "name",
   "description",
   "scope",
   "is_system",
   "active",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "code"
   ]
  ]
 },
 "ai_agent_checkpoints": {
  "columns": [
   "run_id",
   "revision",
   "node_id",
   "status",
   "reviewers_json",
   "snapshot_encrypted",
   "expires_at",
   "decided_by",
   "decision_note",
   "created_at",
   "decided_at"
  ],
  "identity": null,
  "keys": [
   [
    "run_id"
   ]
  ]
 },
 "ai_agent_debug_contexts": {
  "columns": [
   "run_id",
   "context_encrypted"
  ],
  "identity": null,
  "keys": [
   [
    "run_id"
   ]
  ]
 },
 "ai_agent_deployments": {
  "columns": [
   "agent_id",
   "published",
   "identity_id",
   "published_by",
   "published_at"
  ],
  "identity": null,
  "keys": [
   [
    "agent_id"
   ]
  ]
 },
 "ai_agent_designs": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "user_id",
   "fingerprint",
   "status",
   "result_json",
   "error_text",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "ai_agent_drafts": {
  "columns": [
   "agent_id",
   "revision",
   "base_revision",
   "name",
   "enabled",
   "config_json",
   "identity_id",
   "updated_by",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "agent_id"
   ]
  ]
 },
 "ai_agent_eval_batches": {
  "columns": [
   "id",
   "suite_id",
   "suite_revision",
   "agent_id",
   "user_id",
   "api_token_id",
   "name",
   "status",
   "created_at",
   "completed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "ai_agent_eval_items": {
  "columns": [
   "id",
   "batch_id",
   "case_key",
   "variant",
   "config_json",
   "case_json",
   "context_encrypted",
   "source_refs_json",
   "status",
   "run_id",
   "score_json",
   "error_text"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "run_id"
   ]
  ]
 },
 "ai_agent_eval_suites": {
  "columns": [
   "id",
   "agent_id",
   "name",
   "cases_json",
   "revision",
   "created_by",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "ai_agent_identities": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "owner_id",
   "name",
   "enabled",
   "policy_json",
   "monthly_tokens",
   "revision",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "user_id"
   ]
  ]
 },
 "ai_agent_part_versions": {
  "columns": [
   "part_id",
   "version",
   "name",
   "flow_json",
   "created_by",
   "request_id",
   "fingerprint",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "part_id",
    "version"
   ],
   [
    "request_id"
   ]
  ]
 },
 "ai_agent_parts": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "name",
   "version"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "ai_agent_run_feedback": {
  "columns": [
   "run_id",
   "user_id",
   "rating",
   "note",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "run_id",
    "user_id"
   ]
  ]
 },
 "ai_agent_run_state": {
  "columns": [
   "run_id",
   "dry_run",
   "context_fingerprint",
   "heartbeat_at"
  ],
  "identity": null,
  "keys": [
   [
    "run_id"
   ]
  ]
 },
 "ai_agent_run_steps": {
  "columns": [
   "run_id",
   "node_id",
   "position",
   "name",
   "node_type",
   "status",
   "input_count",
   "output_json",
   "duration_ms",
   "error_text",
   "created_at",
   "updated_at",
   "input_encrypted",
   "input_tokens",
   "output_tokens"
  ],
  "identity": null,
  "keys": [
   [
    "run_id",
    "node_id"
   ]
  ]
 },
 "ai_agent_runs": {
  "columns": [
   "id",
   "agent_id",
   "workspace_id",
   "project_id",
   "actor_id",
   "api_token_id",
   "agent_revision",
   "config_json",
   "trigger_type",
   "trigger_key",
   "trigger_context_json",
   "status",
   "source_refs_json",
   "source_meta_json",
   "result_json",
   "applied_json",
   "model",
   "error_text",
   "input_tokens",
   "output_tokens",
   "reviewed_by",
   "created_at",
   "started_at",
   "completed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "agent_id",
    "trigger_key"
   ]
  ]
 },
 "ai_agent_versions": {
  "columns": [
   "agent_id",
   "revision",
   "name",
   "enabled",
   "config_json",
   "saved_by",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "agent_id",
    "revision"
   ]
  ]
 },
 "ai_agents": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "name",
   "enabled",
   "config_json",
   "revision",
   "execution_user_id",
   "execution_api_token_id",
   "next_run_at",
   "last_error",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "ai_jobs": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "conference_id",
   "job_type",
   "requested_by",
   "request_id",
   "cache_key",
   "profile_id",
   "profile_revision",
   "provider_name",
   "model",
   "instructions",
   "input_json",
   "source_meta_json",
   "result_text",
   "status",
   "error_text",
   "input_tokens",
   "output_tokens",
   "incomplete",
   "created_at",
   "started_at",
   "completed_at",
   "recording_id",
   "requested_api_token_id",
   "heartbeat_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "cache_key"
   ],
   [
    "workspace_id",
    "requested_by",
    "request_id"
   ]
  ]
 },
 "ai_usage_ledger": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "purpose",
   "profile_id",
   "model",
   "status",
   "reserved_tokens",
   "charged_tokens",
   "input_tokens",
   "output_tokens",
   "created_at",
   "completed_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "allure_connections": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "plan_id",
   "name",
   "report_base_url",
   "key_strategy",
   "create_missing",
   "enabled",
   "revision",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "allure_imports": {
  "columns": [
   "id",
   "connection_id",
   "run_id",
   "external_id",
   "fingerprint",
   "report_url",
   "summary_json",
   "results_json",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "connection_id",
    "external_id"
   ],
   [
    "run_id"
   ]
  ]
 },
 "api_tokens": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "name",
   "token_prefix",
   "token_hash",
   "scopes_json",
   "expires_at",
   "last_used_at",
   "revoked_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "token_hash"
   ]
  ]
 },
 "approval_gates": {
  "columns": [
   "project_id",
   "stage_id",
   "required_fields_json"
  ],
  "identity": null,
  "keys": [
   [
    "project_id",
    "stage_id"
   ]
  ]
 },
 "approval_requests": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "task_id",
   "task_version_number",
   "title",
   "mode",
   "status",
   "requested_by",
   "due_at",
   "reason",
   "created_at",
   "completed_at",
   "reminded_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "approval_steps": {
  "columns": [
   "id",
   "request_id",
   "position",
   "reviewer_id",
   "substitute_id",
   "decision",
   "decided_by",
   "comment",
   "decided_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "request_id",
    "position"
   ]
  ]
 },
 "audit_log": {
  "columns": [
   "id",
   "workspace_id",
   "actor_id",
   "action",
   "entity_type",
   "entity_id",
   "details_json",
   "ip_address",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "auth_challenges": {
  "columns": [
   "token_hash",
   "user_id",
   "expires_at",
   "used_at",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "token_hash"
   ]
  ]
 },
 "automation_executions": {
  "columns": [
   "rule_id",
   "event_id",
   "step_path",
   "status",
   "result_json"
  ],
  "identity": null,
  "keys": [
   [
    "rule_id",
    "event_id",
    "step_path"
   ]
  ]
 },
 "automation_rules": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "name",
   "description",
   "enabled",
   "trigger_type",
   "trigger_config_json",
   "conditions_json",
   "actions_json",
   "run_as_user_id",
   "last_run_at",
   "run_count",
   "error_count",
   "created_at",
   "updated_at",
   "next_run_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "automation_runs": {
  "columns": [
   "id",
   "rule_id",
   "event_id",
   "status",
   "input_json",
   "result_json",
   "error_text",
   "started_at",
   "finished_at",
   "created_at",
   "step_results_json"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "browser_push_subscriptions": {
  "columns": [
   "id",
   "user_id",
   "workspace_id",
   "session_id",
   "subscription_encrypted",
   "last_notification_id",
   "last_chat_message_id",
   "next_attempt_at",
   "lease_token",
   "lease_until",
   "failures",
   "created_at",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "business_calendars": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "timezone",
   "weekly_json",
   "holidays_json",
   "revision",
   "created_by"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "chat_attachments": {
  "columns": [
   "id",
   "message_id",
   "object_key",
   "file_name",
   "mime_type",
   "size_bytes",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "chat_channel_members": {
  "columns": [
   "channel_id",
   "user_id",
   "member_role",
   "last_read_at",
   "joined_at",
   "last_read_message_id"
  ],
  "identity": null,
  "keys": [
   [
    "channel_id",
    "user_id"
   ]
  ]
 },
 "chat_channels": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "channel_type",
   "name",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "chat_messages": {
  "columns": [
   "id",
   "channel_id",
   "sender_id",
   "reply_to_id",
   "body",
   "message_type",
   "edited_at",
   "deleted_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "chat_room_invites": {
  "columns": [
   "channel_id",
   "user_id",
   "invited_by",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "channel_id",
    "user_id"
   ]
  ]
 },
 "chat_rooms": {
  "columns": [
   "channel_id",
   "join_policy",
   "description",
   "archived",
   "revision"
  ],
  "identity": null,
  "keys": [
   [
    "channel_id"
   ]
  ]
 },
 "comment_voice_attachments": {
  "columns": [
   "id",
   "comment_id",
   "object_key",
   "mime_type",
   "size_bytes",
   "duration_seconds",
   "transcript_status",
   "transcript_text",
   "transcript_error",
   "transcript_updated_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "comment_id"
   ]
  ]
 },
 "comments": {
  "columns": [
   "id",
   "task_id",
   "author_id",
   "body",
   "is_internal",
   "created_at",
   "updated_at",
   "deleted_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "conference_admissions": {
  "columns": [
   "conference_id",
   "user_id",
   "status",
   "requested_at",
   "decided_at",
   "decided_by"
  ],
  "identity": null,
  "keys": [
   [
    "conference_id",
    "user_id"
   ]
  ]
 },
 "conference_attendance": {
  "columns": [
   "participant_sid",
   "conference_id",
   "user_id",
   "room_key",
   "joined_at",
   "left_at"
  ],
  "identity": null,
  "keys": [
   [
    "participant_sid"
   ]
  ]
 },
 "conference_breakout_members": {
  "columns": [
   "breakout_id",
   "user_id"
  ],
  "identity": null,
  "keys": [
   [
    "breakout_id",
    "user_id"
   ]
  ]
 },
 "conference_breakouts": {
  "columns": [
   "id",
   "conference_id",
   "name",
   "room_key",
   "closed",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "room_key"
   ]
  ]
 },
 "conference_captions": {
  "columns": [
   "id",
   "conference_id",
   "workspace_id",
   "user_id",
   "client_id",
   "payload_hash",
   "status",
   "reserved_seconds",
   "duration_seconds",
   "sequence_number",
   "text",
   "created_at",
   "completed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "conference_id",
    "user_id",
    "client_id"
   ],
   [
    "conference_id",
    "sequence_number"
   ]
  ]
 },
 "conference_media_events": {
  "columns": [
   "event_id",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "event_id"
   ]
  ]
 },
 "conference_messages": {
  "columns": [
   "id",
   "conference_id",
   "sender_id",
   "message_type",
   "body",
   "client_id",
   "revision",
   "question_status",
   "moderated_by",
   "moderated_at",
   "edited_at",
   "deleted_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "conference_id",
    "sender_id",
    "client_id"
   ]
  ]
 },
 "conference_participants": {
  "columns": [
   "conference_id",
   "user_id",
   "participant_role",
   "invited_at",
   "responded_at",
   "response",
   "hand_raised_at",
   "last_joined_at"
  ],
  "identity": null,
  "keys": [
   [
    "conference_id",
    "user_id"
   ]
  ]
 },
 "conference_polls": {
  "columns": [
   "id",
   "conference_id",
   "question",
   "options_json",
   "results_visible",
   "closed",
   "revision",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "conference_presence": {
  "columns": [
   "conference_id",
   "user_id",
   "session_id",
   "audio_enabled",
   "video_enabled",
   "last_seen_at"
  ],
  "identity": null,
  "keys": [
   [
    "conference_id",
    "user_id"
   ]
  ]
 },
 "conference_recording_transcripts": {
  "columns": [
   "recording_id",
   "chunk_index",
   "start_seconds",
   "text",
   "profile_revision"
  ],
  "identity": null,
  "keys": [
   [
    "recording_id",
    "chunk_index"
   ]
  ]
 },
 "conference_recordings": {
  "columns": [
   "id",
   "workspace_id",
   "conference_id",
   "created_by",
   "request_id",
   "object_key",
   "egress_id",
   "status",
   "active_slot",
   "stop_requested",
   "error_text",
   "bytes",
   "duration_seconds",
   "created_at",
   "started_at",
   "completed_at",
   "transcript_status",
   "transcript_requested_by",
   "transcript_api_token_id",
   "transcript_revision",
   "transcript_profile_revision",
   "transcript_error",
   "transcript_chunks",
   "transcript_completed_chunks",
   "transcript_heartbeat_at",
   "transcript_completed_at",
   "retained_until",
   "deleted_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "request_id"
   ],
   [
    "conference_id",
    "active_slot"
   ],
   [
    "egress_id"
   ]
  ]
 },
 "conference_votes": {
  "columns": [
   "poll_id",
   "user_id",
   "option_index",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "poll_id",
    "user_id"
   ]
  ]
 },
 "conferences": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "title",
   "description",
   "scheduled_start",
   "scheduled_end",
   "status",
   "conference_mode",
   "capacity",
   "max_publishers",
   "join_policy",
   "join_code",
   "media_room_ready_at",
   "room_key",
   "created_by",
   "reminder_sent_at",
   "created_at",
   "updated_at",
   "waiting_room",
   "captions_enabled",
   "caption_sequence"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "room_key"
   ],
   [
    "join_code"
   ]
  ]
 },
 "dashboard_subscriptions": {
  "columns": [
   "user_id",
   "dashboard_id",
   "enabled",
   "frequency",
   "timezone",
   "delivery_hour",
   "weekday",
   "last_sent_at",
   "last_attempt_at",
   "last_error",
   "revision"
  ],
  "identity": null,
  "keys": [
   [
    "user_id",
    "dashboard_id"
   ]
  ]
 },
 "dashboard_widgets": {
  "columns": [
   "id",
   "dashboard_id",
   "widget_type",
   "title",
   "config_json",
   "position_json"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "dashboards": {
  "columns": [
   "id",
   "workspace_id",
   "owner_id",
   "name",
   "is_shared",
   "layout_json",
   "created_at",
   "updated_at",
   "revision",
   "share_group_id",
   "is_template"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "development_connections": {
  "columns": [
   "id",
   "project_id",
   "provider",
   "name",
   "repository_url",
   "secret_encrypted",
   "enabled"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "development_events": {
  "columns": [
   "id",
   "connection_id",
   "external_id",
   "task_id",
   "kind",
   "title",
   "url",
   "state",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "connection_id",
    "external_id",
    "task_id"
   ]
  ]
 },
 "directory_sync_configs": {
  "columns": [
   "workspace_id",
   "enabled",
   "config_json",
   "last_sync_at",
   "last_result_json",
   "last_error"
  ],
  "identity": null,
  "keys": [
   [
    "workspace_id"
   ]
  ]
 },
 "external_bindings": {
  "columns": [
   "id",
   "connection_id",
   "entity_id",
   "external_key",
   "baseline_encrypted",
   "conflict_encrypted",
   "status",
   "resolution",
   "resolution_hash",
   "error_code",
   "synced_at",
   "checked_at",
   "revision"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "connection_id",
    "entity_id"
   ],
   [
    "connection_id",
    "external_key"
   ]
  ]
 },
 "external_connections": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "project_id",
   "kind",
   "name",
   "credentials_encrypted",
   "config_json",
   "enabled",
   "revision",
   "next_sync_at",
   "synced_at",
   "error_code",
   "lease_token",
   "lease_until",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "external_sync_log": {
  "columns": [
   "id",
   "connection_id",
   "binding_id",
   "action",
   "error_code",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "import_jobs": {
  "columns": [
   "id",
   "workspace_id",
   "requested_by",
   "source_type",
   "status",
   "object_key",
   "options_json",
   "result_json",
   "error_text",
   "created_at",
   "started_at",
   "finished_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "integration_connections": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "provider",
   "name",
   "destination_label",
   "config_json",
   "credentials_encrypted",
   "event_types_json",
   "enabled",
   "version_number",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "integration_connections_legacy_002": {
  "columns": [
   "id",
   "workspace_id",
   "provider",
   "name",
   "config_json",
   "secrets_encrypted",
   "enabled",
   "last_sync_at",
   "last_error",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "integration_deliveries": {
  "columns": [
   "id",
   "connection_id",
   "event_uuid",
   "event_type",
   "task_id",
   "requested_by",
   "payload_encrypted",
   "connection_version",
   "status",
   "attempts",
   "available_at",
   "lease_token",
   "lease_until",
   "http_status",
   "error_code",
   "created_at",
   "completed_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ],
   [
    "connection_id",
    "event_uuid"
   ]
  ]
 },
 "integration_health": {
  "columns": [
   "connection_id",
   "degraded",
   "last_alert_at",
   "last_success_at",
   "last_failure_at"
  ],
  "identity": null,
  "keys": [
   [
    "connection_id"
   ]
  ]
 },
 "issue_type_scheme_items": {
  "columns": [
   "scheme_id",
   "issue_type_id",
   "position"
  ],
  "identity": null,
  "keys": [
   [
    "scheme_id",
    "issue_type_id"
   ]
  ]
 },
 "issue_type_schemes": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "description",
   "is_default"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "issue_types": {
  "columns": [
   "id",
   "workspace_id",
   "code",
   "name",
   "description",
   "icon",
   "color",
   "hierarchy_level",
   "is_subtask",
   "position",
   "active"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "code"
   ]
  ]
 },
 "jira_import_files": {
  "columns": [
   "id",
   "job_id",
   "row_index",
   "external_id",
   "file_name",
   "expected_size",
   "mime_type",
   "object_key",
   "checksum_sha256",
   "attached"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "job_id",
    "row_index",
    "external_id"
   ]
  ]
 },
 "jira_import_jobs": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "user_id",
   "api_token_id",
   "status",
   "phase",
   "cursor_row",
   "total",
   "preview_hash",
   "include_attachments",
   "revision",
   "lease_token",
   "lease_until",
   "error_code",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "jira_import_records": {
  "columns": [
   "job_id",
   "row_index",
   "external_key",
   "payload_encrypted",
   "task_id",
   "status",
   "warnings_json",
   "links_complete"
  ],
  "identity": null,
  "keys": [
   [
    "job_id",
    "row_index"
   ]
  ]
 },
 "jira_task_history": {
  "columns": [
   "id",
   "task_id",
   "source_key",
   "entry_key",
   "kind",
   "source_author",
   "source_date",
   "body_text"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "task_id",
    "entry_key"
   ]
  ]
 },
 "jira_transfer_files": {
  "columns": [
   "item_id",
   "file_id",
   "attachment_id",
   "checksum_sha256"
  ],
  "identity": null,
  "keys": [
   [
    "item_id",
    "file_id"
   ]
  ]
 },
 "jira_transfer_items": {
  "columns": [
   "id",
   "source_id",
   "issue_id",
   "issue_key",
   "task_id",
   "seen_run",
   "payload_encrypted",
   "baseline_encrypted",
   "status",
   "warnings_json",
   "error_code",
   "choice",
   "choice_version",
   "files_expected",
   "files_done",
   "links_pending",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "source_id",
    "issue_id"
   ]
  ]
 },
 "jira_transfer_sources": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "user_id",
   "name",
   "kind",
   "url",
   "project_key",
   "credentials_encrypted",
   "mapping_json",
   "catalog_json",
   "include_files",
   "status",
   "phase",
   "cursor_value",
   "run_number",
   "revision",
   "lease_token",
   "lease_until",
   "available_at",
   "attempts",
   "error_code",
   "prepared_at",
   "completed_at",
   "cutover_at",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "knowledge_annotations": {
  "columns": [
   "id",
   "article_id",
   "block_id",
   "quote_text",
   "body",
   "author_id",
   "resolved_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "knowledge_article_revisions": {
  "columns": [
   "id",
   "article_id",
   "version_number",
   "title",
   "body",
   "changed_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "article_id",
    "version_number"
   ]
  ]
 },
 "knowledge_articles": {
  "columns": [
   "id",
   "space_id",
   "parent_id",
   "title",
   "slug",
   "body",
   "status",
   "version_number",
   "author_id",
   "published_at",
   "created_at",
   "updated_at",
   "steward_id",
   "review_due_date",
   "review_status",
   "reviewed_by",
   "reviewed_version",
   "review_reminded_date"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "space_id",
    "slug"
   ]
  ]
 },
 "knowledge_blocks": {
  "columns": [
   "id",
   "article_id",
   "position",
   "body",
   "revision",
   "updated_by",
   "updated_at",
   "deleted_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "knowledge_collaborators": {
  "columns": [
   "article_id",
   "user_id",
   "seen_at"
  ],
  "identity": null,
  "keys": [
   [
    "article_id",
    "user_id"
   ]
  ]
 },
 "knowledge_crdt": {
  "columns": [
   "article_id",
   "epoch",
   "state_blob",
   "body_hash",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "article_id"
   ]
  ]
 },
 "knowledge_cursors": {
  "columns": [
   "article_id",
   "user_id",
   "client_id",
   "epoch",
   "anchor_json",
   "focus_json",
   "seen_at"
  ],
  "identity": null,
  "keys": [
   [
    "article_id",
    "user_id",
    "client_id"
   ]
  ]
 },
 "knowledge_space_permissions": {
  "columns": [
   "id",
   "space_id",
   "principal_type",
   "principal_id",
   "access_level",
   "granted_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "space_id",
    "principal_type",
    "principal_id"
   ]
  ]
 },
 "knowledge_spaces": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "slug",
   "description",
   "visibility",
   "owner_team_id",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "slug"
   ]
  ]
 },
 "knowledge_team_members": {
  "columns": [
   "team_id",
   "user_id",
   "team_role",
   "added_by",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "team_id",
    "user_id"
   ]
  ]
 },
 "knowledge_teams": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "slug",
   "description",
   "color",
   "active",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "slug"
   ]
  ]
 },
 "labels": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "color"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "name"
   ]
  ]
 },
 "maintenance_cursors": {
  "columns": [
   "name",
   "last_id",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "name"
   ]
  ]
 },
 "meeting_actions": {
  "columns": [
   "id",
   "conference_id",
   "recording_id",
   "source_seconds",
   "source_text",
   "title",
   "description",
   "assignee_id",
   "due_date",
   "status",
   "task_id",
   "generated_by",
   "fingerprint",
   "created_at",
   "reviewed_by"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "conference_id",
    "fingerprint"
   ]
  ]
 },
 "notification_preferences": {
  "columns": [
   "user_id",
   "timezone",
   "quiet_start",
   "quiet_end",
   "digest",
   "digest_hour",
   "last_digest_at",
   "mentions_only",
   "email_enabled",
   "enabled_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "objective_checkins": {
  "columns": [
   "id",
   "key_result_id",
   "value",
   "confidence",
   "note",
   "user_id",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "objective_key_results": {
  "columns": [
   "id",
   "objective_id",
   "title",
   "mode",
   "unit",
   "start_value",
   "target_value",
   "current_value",
   "weight",
   "confidence",
   "revision"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "objective_task_links": {
  "columns": [
   "key_result_id",
   "task_id"
  ],
  "identity": null,
  "keys": [
   [
    "key_result_id",
    "task_id"
   ]
  ]
 },
 "offline_operations": {
  "columns": [
   "user_id",
   "operation_id",
   "request_hash",
   "result_json",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id",
    "operation_id"
   ]
  ]
 },
 "outbox_events": {
  "columns": [
   "id",
   "event_uuid",
   "workspace_id",
   "event_type",
   "aggregate_type",
   "aggregate_id",
   "payload_json",
   "available_at",
   "processed_at",
   "attempts",
   "last_error",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "event_uuid"
   ]
  ]
 },
 "permission_grants": {
  "columns": [
   "id",
   "scheme_id",
   "permission_key",
   "principal_type",
   "principal_value"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "permission_schemes": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "description",
   "is_default",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "portfolio_baselines": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "created_by",
   "snapshot_json",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "project_access_requests": {
  "columns": [
   "id",
   "project_id",
   "user_id",
   "project_role",
   "reason",
   "expires_at",
   "status",
   "decided_by",
   "decision_reason",
   "decided_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "project_components": {
  "columns": [
   "id",
   "project_id",
   "name",
   "description",
   "lead_user_id"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "project_id",
    "name"
   ]
  ]
 },
 "project_group_access": {
  "columns": [
   "project_id",
   "group_id",
   "project_role",
   "created_by",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "project_id",
    "group_id"
   ]
  ]
 },
 "project_groups": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "description",
   "color",
   "position",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "project_members": {
  "columns": [
   "project_id",
   "user_id",
   "project_role",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "project_id",
    "user_id"
   ]
  ]
 },
 "project_templates": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "description",
   "workflow_id",
   "issue_type_scheme_id",
   "permission_scheme_id",
   "default_group_id",
   "color",
   "duration_days",
   "default_tasks_json",
   "active",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "name"
   ]
  ]
 },
 "projects": {
  "columns": [
   "id",
   "workspace_id",
   "group_id",
   "workflow_id",
   "issue_type_scheme_id",
   "permission_scheme_id",
   "key_code",
   "name",
   "description",
   "color",
   "status",
   "start_date",
   "target_date",
   "created_by",
   "created_at",
   "updated_at",
   "deleted_at",
   "tribe_id",
   "owner_id",
   "access_mode",
   "access_revision"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "key_code"
   ]
  ]
 },
 "quality_case_tasks": {
  "columns": [
   "case_id",
   "task_id"
  ],
  "identity": null,
  "keys": [
   [
    "case_id",
    "task_id"
   ]
  ]
 },
 "quality_cases": {
  "columns": [
   "id",
   "project_id",
   "title",
   "preconditions",
   "steps_json",
   "automation_key",
   "priority",
   "archived",
   "revision",
   "created_by",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "project_id",
    "automation_key"
   ]
  ]
 },
 "quality_plan_cases": {
  "columns": [
   "plan_id",
   "case_id"
  ],
  "identity": null,
  "keys": [
   [
    "plan_id",
    "case_id"
   ]
  ]
 },
 "quality_plans": {
  "columns": [
   "id",
   "project_id",
   "release_id",
   "title",
   "revision",
   "created_by"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "quality_result_batches": {
  "columns": [
   "run_id",
   "request_id",
   "fingerprint",
   "user_id",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "run_id",
    "request_id"
   ]
  ]
 },
 "quality_result_history": {
  "columns": [
   "id",
   "run_id",
   "case_id",
   "result",
   "notes",
   "defect_task_id",
   "user_id",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "quality_run_items": {
  "columns": [
   "run_id",
   "case_id",
   "snapshot_json",
   "result",
   "notes",
   "defect_task_id",
   "revision",
   "updated_by",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "run_id",
    "case_id"
   ]
  ]
 },
 "quality_runs": {
  "columns": [
   "id",
   "plan_id",
   "title",
   "release_id",
   "status",
   "created_by",
   "created_at",
   "completed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "recording_chapters": {
  "columns": [
   "id",
   "recording_id",
   "start_seconds",
   "title",
   "created_by"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "recording_transcript_edits": {
  "columns": [
   "id",
   "recording_id",
   "chunk_index",
   "original_text",
   "replacement_text",
   "changed_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "releases": {
  "columns": [
   "id",
   "project_id",
   "name",
   "description",
   "status",
   "start_date",
   "release_date",
   "released_at",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "project_id",
    "name"
   ]
  ]
 },
 "resource_absences": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "start_date",
   "end_date",
   "unavailable_percent",
   "label"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "resource_allocations": {
  "columns": [
   "id",
   "project_id",
   "user_id",
   "start_date",
   "end_date",
   "hours_per_day"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "resource_calendars": {
  "columns": [
   "user_id",
   "workspace_id",
   "hours_json",
   "timezone"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "runtime_heartbeats": {
  "columns": [
   "instance_id",
   "component",
   "last_seen_at"
  ],
  "identity": null,
  "keys": [
   [
    "instance_id"
   ]
  ]
 },
 "saved_filters": {
  "columns": [
   "id",
   "workspace_id",
   "owner_id",
   "name",
   "query_text",
   "is_shared",
   "is_favorite",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "security_rate_limits": {
  "columns": [
   "bucket_hash",
   "window_start",
   "attempts",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "bucket_hash"
   ]
  ]
 },
 "semantic_buckets": {
  "columns": [
   "document_id",
   "workspace_id",
   "namespace",
   "band",
   "bucket"
  ],
  "identity": null,
  "keys": [
   [
    "document_id",
    "band"
   ]
  ]
 },
 "semantic_documents": {
  "columns": [
   "id",
   "workspace_id",
   "namespace",
   "kind",
   "source_id",
   "chunk_index",
   "content_hash",
   "chunk_start",
   "chunk_length",
   "vector_encrypted",
   "indexed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "namespace",
    "kind",
    "source_id",
    "chunk_index"
   ]
  ]
 },
 "semantic_jobs": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "api_token_id",
   "namespace",
   "status",
   "kind_index",
   "cursor_id",
   "indexed_count",
   "skipped_count",
   "lease_token",
   "lease_until",
   "error_code",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "semantic_settings": {
  "columns": [
   "workspace_id",
   "enabled",
   "profile_id",
   "model",
   "revision"
  ],
  "identity": null,
  "keys": [
   [
    "workspace_id"
   ]
  ]
 },
 "service_queues": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "name",
   "description",
   "query_text",
   "position"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "project_id",
    "name"
   ]
  ]
 },
 "service_requests": {
  "columns": [
   "id",
   "task_id",
   "requester_id",
   "requester_email",
   "channel",
   "request_type",
   "organization_name",
   "first_response_at",
   "resolved_at",
   "sla_first_response_due",
   "sla_resolution_due",
   "satisfaction_score",
   "satisfaction_comment",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "task_id"
   ]
  ]
 },
 "sla_notification_dispatches": {
  "columns": [
   "fingerprint",
   "task_id",
   "policy_id",
   "event_type",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "fingerprint"
   ]
  ]
 },
 "sla_notification_settings": {
  "columns": [
   "policy_id",
   "revision",
   "enabled",
   "notify_assignee",
   "warning",
   "breached",
   "escalation_minutes",
   "escalation_user_ids_json",
   "updated_by",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "policy_id"
   ]
  ]
 },
 "sla_policies": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "name",
   "metric_type",
   "goal_minutes",
   "calendar_json",
   "conditions_json",
   "enabled"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "sprints": {
  "columns": [
   "id",
   "project_id",
   "name",
   "goal",
   "status",
   "start_date",
   "end_date",
   "completed_at",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "system_settings": {
  "columns": [
   "workspace_id",
   "category",
   "value_json",
   "updated_by",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "workspace_id",
    "category"
   ]
  ]
 },
 "task_attachments": {
  "columns": [
   "id",
   "task_id",
   "uploaded_by",
   "file_name",
   "object_key",
   "mime_type",
   "size_bytes",
   "checksum_sha256",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "object_key"
   ]
  ]
 },
 "task_checklist_items": {
  "columns": [
   "id",
   "task_id",
   "title",
   "completed",
   "completed_by",
   "completed_at",
   "position",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "task_dependencies": {
  "columns": [
   "task_id",
   "depends_on_task_id",
   "dependency_type",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "task_id",
    "depends_on_task_id"
   ]
  ]
 },
 "task_field_access": {
  "columns": [
   "project_id",
   "field_code",
   "readers_json",
   "editors_json"
  ],
  "identity": null,
  "keys": [
   [
    "project_id",
    "field_code"
   ]
  ]
 },
 "task_field_contexts": {
  "columns": [
   "id",
   "field_id",
   "project_id",
   "issue_type_id",
   "default_value_json",
   "required_override"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "field_id",
    "project_id",
    "issue_type_id"
   ]
  ]
 },
 "task_field_definitions": {
  "columns": [
   "id",
   "workspace_id",
   "code",
   "label",
   "field_type",
   "required",
   "options_json",
   "position",
   "active",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "code"
   ]
  ]
 },
 "task_labels": {
  "columns": [
   "task_id",
   "label_id"
  ],
  "identity": null,
  "keys": [
   [
    "task_id",
    "label_id"
   ]
  ]
 },
 "task_revisions": {
  "columns": [
   "id",
   "task_id",
   "changed_by",
   "version_number",
   "change_type",
   "changes_json",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "task_id",
    "version_number"
   ]
  ]
 },
 "task_sla_policies": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "name",
   "description",
   "goal_minutes",
   "warning_percent",
   "conditions_json",
   "enabled",
   "position",
   "created_by",
   "created_at",
   "updated_at",
   "counter_key",
   "calendar_id",
   "config_json",
   "revision"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "task_state_events": {
  "columns": [
   "id",
   "task_id",
   "stage_id",
   "is_done",
   "occurred_at",
   "source"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "task_undo_actions": {
  "columns": [
   "id",
   "user_id",
   "task_id",
   "version_number",
   "before_json",
   "expires_at",
   "used_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "task_watchers": {
  "columns": [
   "task_id",
   "user_id",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "task_id",
    "user_id"
   ]
  ]
 },
 "tasks": {
  "columns": [
   "id",
   "project_id",
   "stage_id",
   "issue_type_id",
   "parent_task_id",
   "epic_task_id",
   "sprint_id",
   "release_id",
   "component_id",
   "task_number",
   "title",
   "description",
   "environment",
   "priority",
   "reporter_id",
   "assignee_id",
   "start_date",
   "due_date",
   "estimate_minutes",
   "story_points",
   "spent_minutes",
   "progress",
   "resolution",
   "position",
   "rank_value",
   "milestone",
   "custom_values_json",
   "version_number",
   "created_at",
   "updated_at",
   "completed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "project_id",
    "task_number"
   ]
  ]
 },
 "telephony_calls": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "task_id",
   "conference_id",
   "direction",
   "from_number",
   "to_number",
   "provider_call_id",
   "status",
   "record_call",
   "initiated_by",
   "started_at",
   "answered_at",
   "ended_at",
   "duration_seconds",
   "failure_reason",
   "metadata_json",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "provider_call_id"
   ]
  ]
 },
 "user_api_access": {
  "columns": [
   "user_id",
   "workspace_id",
   "enabled",
   "allowed_scopes_json",
   "max_token_ttl_days",
   "updated_by",
   "created_at",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "user_dashboard_preferences": {
  "columns": [
   "user_id",
   "home_dashboard_id",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "user_favorites": {
  "columns": [
   "user_id",
   "revision",
   "items_json",
   "updated_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "user_mfa": {
  "columns": [
   "user_id",
   "secret_encrypted",
   "pending_secret_encrypted",
   "pending_expires_at",
   "enabled",
   "last_counter",
   "recovery_hashes_json",
   "changed_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "user_notifications": {
  "columns": [
   "id",
   "user_id",
   "event_type",
   "title",
   "body",
   "entity_type",
   "entity_id",
   "action_url",
   "read_at",
   "created_at",
   "mail_delivered_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "user_presence": {
  "columns": [
   "user_id",
   "workspace_id",
   "state",
   "last_seen_at"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "user_sessions": {
  "columns": [
   "id",
   "user_id",
   "user_agent",
   "created_at",
   "last_seen_at",
   "expires_at",
   "revoked_at",
   "mfa_verified"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "user_work_views": {
  "columns": [
   "user_id",
   "revision",
   "config_json"
  ],
  "identity": null,
  "keys": [
   [
    "user_id"
   ]
  ]
 },
 "users": {
  "columns": [
   "id",
   "workspace_id",
   "email",
   "display_name",
   "password_hash",
   "global_role",
   "auth_source",
   "external_subject",
   "status",
   "avatar_color",
   "last_login_at",
   "created_at",
   "updated_at",
   "external_issuer",
   "directory_disabled",
   "is_service"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "email"
   ]
  ]
 },
 "webhooks": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "target_url",
   "secret_encrypted",
   "event_types_json",
   "enabled",
   "last_status",
   "last_delivery_at",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "webrtc_signals": {
  "columns": [
   "id",
   "conference_id",
   "sender_id",
   "recipient_id",
   "signal_type",
   "payload_json",
   "created_at",
   "consumed_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "work_ai_jobs": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "api_token_id",
   "conference_id",
   "recording_id",
   "status",
   "progress",
   "error_text",
   "heartbeat_at",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "work_ai_requests": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "purpose",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "work_import_items": {
  "columns": [
   "project_id",
   "external_key",
   "task_id"
  ],
  "identity": null,
  "keys": [
   [
    "project_id",
    "external_key"
   ]
  ]
 },
 "work_objectives": {
  "columns": [
   "id",
   "project_id",
   "title",
   "description",
   "owner_id",
   "due_date",
   "archived",
   "revision",
   "created_by",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "work_plan_dependencies": {
  "columns": [
   "id",
   "plan_id",
   "item_id",
   "depends_on_item_id",
   "depends_on_task_id"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "item_id",
    "depends_on_item_id"
   ],
   [
    "item_id",
    "depends_on_task_id"
   ]
  ]
 },
 "work_plan_items": {
  "columns": [
   "id",
   "plan_id",
   "parent_id",
   "kind",
   "title",
   "description",
   "priority",
   "assignee_id",
   "start_date",
   "due_date",
   "estimate_minutes",
   "story_points",
   "objective_id",
   "state",
   "task_id",
   "revision",
   "created_by",
   "request_id",
   "creation_hash",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "plan_id",
    "created_by",
    "request_id"
   ],
   [
    "task_id"
   ]
  ]
 },
 "work_plan_members": {
  "columns": [
   "plan_id",
   "user_id",
   "can_edit"
  ],
  "identity": null,
  "keys": [
   [
    "plan_id",
    "user_id"
   ]
  ]
 },
 "work_plan_reviewers": {
  "columns": [
   "review_id",
   "user_id",
   "decision",
   "comment",
   "decided_at"
  ],
  "identity": null,
  "keys": [
   [
    "review_id",
    "user_id"
   ]
  ]
 },
 "work_plan_reviews": {
  "columns": [
   "id",
   "plan_id",
   "content_hash",
   "requested_by",
   "request_id",
   "reason",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "plan_id",
    "requested_by",
    "request_id"
   ]
  ]
 },
 "work_plan_strategy": {
  "columns": [
   "plan_id",
   "revision",
   "outcome",
   "impact",
   "effort",
   "rationale"
  ],
  "identity": null,
  "keys": [
   [
    "plan_id"
   ]
  ]
 },
 "work_plan_suggestions": {
  "columns": [
   "id",
   "plan_id",
   "user_id",
   "fingerprint",
   "content_hash",
   "status",
   "proposals_json",
   "applied_json",
   "selection_hash",
   "error_text",
   "created_at",
   "source_goal_id",
   "source_goal_hash"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "work_plans": {
  "columns": [
   "id",
   "workspace_id",
   "project_id",
   "title",
   "description",
   "start_date",
   "due_date",
   "objective_id",
   "archived",
   "revision",
   "created_by",
   "request_id",
   "creation_hash",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "created_by",
    "request_id"
   ]
  ]
 },
 "work_roadmap_changes": {
  "columns": [
   "id",
   "workspace_id",
   "user_id",
   "fingerprint",
   "result_json",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "id"
   ]
  ]
 },
 "workflow_stages": {
  "columns": [
   "id",
   "workflow_id",
   "code",
   "name",
   "color",
   "position",
   "category",
   "wip_limit",
   "is_done",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workflow_id",
    "code"
   ]
  ]
 },
 "workflow_transitions": {
  "columns": [
   "id",
   "workflow_id",
   "from_stage_id",
   "to_stage_id",
   "name",
   "conditions_json",
   "validators_json",
   "actions_json",
   "position"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "workflows": {
  "columns": [
   "id",
   "workspace_id",
   "name",
   "description",
   "is_default",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "worklogs": {
  "columns": [
   "id",
   "task_id",
   "user_id",
   "minutes_spent",
   "work_date",
   "description",
   "created_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ]
  ]
 },
 "workspaces": {
  "columns": [
   "id",
   "name",
   "slug",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "slug"
   ]
  ]
 },
 "tribes": {
  "columns": [
   "id",
   "workspace_id",
   "leader_id",
   "name",
   "description",
   "color",
   "revision",
   "created_by",
   "created_at",
   "updated_at"
  ],
  "identity": "id",
  "keys": [
   [
    "id"
   ],
   [
    "workspace_id",
    "name"
   ]
  ]
 },
 "tribe_members": {
  "columns": [
   "tribe_id",
   "user_id",
   "can_manage_space",
   "can_manage_members",
   "can_create_projects",
   "can_manage_projects",
   "created_at"
  ],
  "identity": null,
  "keys": [
   [
    "tribe_id",
    "user_id"
   ]
  ]
 }
};
