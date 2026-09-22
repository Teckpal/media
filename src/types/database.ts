/**
 * Typed contract for the Postgres schema in `supabase/migrations`.
 *
 * Hand-written rather than generated, because generation needs a running local
 * Supabase (Docker). Once one is available, `npm run db:types` regenerates this
 * file and the shapes below should be replaced wholesale — they exist to give
 * the app real types in the meantime, and they are only as accurate as the
 * migrations they were written against.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// --- enums, mirroring 0001 ---------------------------------------------------
export type PlatformEnum =
  | 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'tiktok' | 'youtube'
export type ModuleTypeEnum = 'self' | 'personal' | 'business'
export type OnboardingStepEnum =
  | 'verify_email' | 'choose_module' | 'setup' | 'connect' | 'first_draft' | 'paywall' | 'done'
export type PostStatusEnum =
  | 'draft' | 'pending_approval' | 'scheduled' | 'publishing' | 'published'
  | 'paused' | 'failed' | 'cancelled' | 'removed'
export type TargetStatusEnum =
  | 'pending' | 'publishing' | 'published' | 'failed' | 'cancelled' | 'removed'
export type ConnectionStatusEnum =
  | 'active' | 'needs_reconnect' | 'disconnected' | 'transferred'
export type TransferStatusEnum = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type WorkspaceRoleEnum = 'viewer' | 'editor' | 'admin' | 'owner'
export type BillingRegionEnum = 'bd' | 'global'
export type CurrencyEnum = 'BDT' | 'USD'
export type SubscriptionStatusEnum =
  | 'active' | 'past_due' | 'grace' | 'paused' | 'cancelled' | 'expired'
export type InvoiceStatusEnum = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
export type PaymentStatusEnum = 'pending' | 'success' | 'failed' | 'refunded'
export type PaymentGatewayEnum =
  | 'sslcommerz' | 'paddle' | 'lemonsqueezy' | 'stripe' | 'stub'
export type AiLedgerKindEnum = 'grant' | 'topup' | 'use' | 'expire' | 'adjust'
export type NotificationChannelEnum = 'in_app' | 'email' | 'whatsapp'

/**
 * Builds the Row / Insert / Update triple supabase-js expects.
 * `Req` names the columns an INSERT must supply; everything else has a default
 * or is nullable, so it is optional.
 */
type Table<Row, Req extends keyof Row> = {
  Row: Row
  Insert: Pick<Row, Req> & Partial<Omit<Row, Req>>
  Update: Partial<Row>
  Relationships: []
}

// --- row shapes --------------------------------------------------------------

export type UserRow = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  signup_country: string | null
  active_module: ModuleTypeEnum | null
  active_workspace_id: string | null
  onboarding_step: OnboardingStepEnum
  onboarding_completed_at: string | null
  whatsapp_number: string | null
  whatsapp_number_verified: boolean
  is_platform_admin: boolean
  created_at: string
  updated_at: string
}

export type WorkspaceRow = {
  id: string
  name: string
  type: ModuleTypeEnum
  owner_id: string
  timezone: string
  billing_region: BillingRegionEnum | null
  billing_region_locked_at: string | null
  is_billing_exempt: boolean
  approvals_enabled: boolean
  created_at: string
  updated_at: string
}

export type WorkspaceMemberRow = {
  workspace_id: string
  user_id: string
  role: WorkspaceRoleEnum
  invited_by: string | null
  joined_at: string
}

export type ProfileSetupRow = {
  workspace_id: string
  brand_name: string | null
  industry: string | null
  website_url: string | null
  description: string | null
  target_audience: string | null
  brand_voice: string | null
  goals: string[] | null
  keywords: string[] | null
  extra: Json
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type InviteRow = {
  id: string
  workspace_id: string
  email: string
  role: WorkspaceRoleEnum
  token_hash: string
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
  revoked_at: string | null
  created_at: string
}

/**
 * Token columns are absent on purpose: 0008 revokes them from `authenticated`,
 * so a browser query that selects them fails at the database. Server code that
 * legitimately needs them uses the service-role client and the
 * `SocialAccountWithTokens` shape below.
 */
export type SocialAccountRow = {
  id: string
  workspace_id: string
  platform: PlatformEnum
  external_account_id: string
  external_username: string | null
  display_name: string | null
  avatar_url: string | null
  account_type: string | null
  parent_external_id: string | null
  token_expires_at: string | null
  scopes: string[] | null
  status: ConnectionStatusEnum
  status_reason: string | null
  paid_seat: boolean
  seat_paid_until: string | null
  connected_by: string | null
  connected_at: string
  last_synced_at: string | null
  disconnected_at: string | null
  created_at: string
  updated_at: string
}

export type SocialAccountWithTokens = SocialAccountRow & {
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
}

/**
 * What a client may read. `from_workspace_id` is absent because migration 0008
 * revokes it: Section 6.1 says the workspace currently holding a contested
 * account must never be revealed to the requester.
 */
export type AccountTransferRequestRow = {
  id: string
  platform: PlatformEnum
  external_account_id: string
  to_workspace_id: string
  requested_by: string
  evidence: string | null
  evidence_urls: string[] | null
  status: TransferStatusEnum
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

/** The full row, for support tooling running with the service role. */
export type AccountTransferRequestWithHolder = AccountTransferRequestRow & {
  from_workspace_id: string | null
}

export type PostMediaRow = {
  id: string
  workspace_id: string
  storage_path: string
  mime_type: string
  byte_size: number | null
  width: number | null
  height: number | null
  duration_ms: number | null
  alt_text: string | null
  uploaded_by: string | null
  created_at: string
}

export type PostRow = {
  id: string
  workspace_id: string
  created_by: string | null
  status: PostStatusEnum
  caption: string
  media_ids: string[]
  scheduled_at: string | null
  published_at: string | null
  is_ai_generated: boolean
  ai_plan_id: string | null
  removed_at: string | null
  removed_by: string | null
  cancelled_at: string | null
  paused_at: string | null
  failed_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type PostTargetRow = {
  id: string
  post_id: string
  social_account_id: string
  platform: PlatformEnum
  status: TargetStatusEnum
  idempotency_key: string
  attempts: number
  last_attempt_at: string | null
  last_error: string | null
  external_post_id: string | null
  external_permalink: string | null
  published_at: string | null
  /** Module 6: the worker's claim on this target, and when it lapses. */
  lease_expires_at: string | null
  /** Module 6: backoff gate. A pending target is not due until this passes. */
  next_attempt_at: string | null
  /** Module 6: Instagram's media container, reused by a retry. */
  external_container_id: string | null
  created_at: string
  updated_at: string
}

export type ApprovalRow = {
  id: string
  post_id: string
  workspace_id: string
  requested_by: string | null
  decided_by: string | null
  state: 'pending' | 'approved' | 'rejected' | 'superseded'
  note: string | null
  requested_at: string
  decided_at: string | null
}

export type PlanRow = {
  id: string
  code: string
  region: BillingRegionEnum
  currency: CurrencyEnum
  display_name: string
  description: string | null
  price_per_seat_minor: number
  ai_credits_per_month: number
  max_seats: number | null
  features: Json
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type SubscriptionRow = {
  id: string
  workspace_id: string
  plan_id: string
  region: BillingRegionEnum
  currency: CurrencyEnum
  gateway: PaymentGatewayEnum
  seats: number
  status: SubscriptionStatusEnum
  current_period_start: string
  current_period_end: string
  auto_renew: boolean
  grace_until: string | null
  cancel_at_period_end: boolean
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export type InvoiceRow = {
  id: string
  workspace_id: string
  subscription_id: string | null
  number: number
  region: BillingRegionEnum
  currency: CurrencyEnum
  subtotal_minor: number
  tax_minor: number
  credit_applied_minor: number
  total_minor: number
  status: InvoiceStatusEnum
  period_start: string | null
  period_end: string | null
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
}

export type InvoiceLineRow = {
  id: string
  invoice_id: string
  kind: 'seat' | 'proration' | 'ai_topup' | 'credit' | 'tax' | 'adjustment'
  description: string
  quantity: number
  unit_amount_minor: number
  amount_minor: number
  social_account_id: string | null
  created_at: string
}

export type PaymentRow = {
  id: string
  workspace_id: string
  invoice_id: string | null
  gateway: PaymentGatewayEnum
  gateway_transaction_id: string
  amount_minor: number
  currency: CurrencyEnum
  status: PaymentStatusEnum
  validated_at: string | null
  validation_response: Json | null
  payment_method: string | null
  payer_country: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export type GatewayEventRow = {
  id: string
  gateway: PaymentGatewayEnum
  event_id: string
  event_type: string | null
  signature_verified: boolean
  payload: Json
  processed_at: string | null
  processing_error: string | null
  received_at: string
}

export type BillingCreditRow = {
  id: string
  workspace_id: string
  currency: CurrencyEnum
  amount_minor: number
  remaining_minor: number
  reason: string
  applied_invoice_id: string | null
  created_at: string
  updated_at: string
}

export type AiCreditLedgerRow = {
  id: string
  workspace_id: string
  kind: AiLedgerKindEnum
  amount: number
  expires_at: string | null
  source: string | null
  request_id: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  invoice_id: string | null
  created_by: string | null
  created_at: string
}

export type AiPlanRow = {
  id: string
  workspace_id: string
  created_by: string | null
  prompt: string | null
  period_start: string | null
  period_end: string | null
  platforms: PlatformEnum[]
  state: 'pending' | 'ready' | 'failed'
  output: Json | null
  error: string | null
  credits_used: number
  created_at: string
  updated_at: string
}

export type NotificationRow = {
  id: string
  workspace_id: string
  user_id: string | null
  kind: string
  title: string
  body: string | null
  link_path: string | null
  data: Json
  read_at: string | null
  created_at: string
}

export type NotificationDeliveryRow = {
  id: string
  notification_id: string
  channel: NotificationChannelEnum
  state: 'pending' | 'sent' | 'failed' | 'skipped'
  provider_id: string | null
  error: string | null
  attempts: number
  sent_at: string | null
  created_at: string
  updated_at: string
}

/** `otp_hash` is revoked from clients. */
export type WhatsappLinkRow = {
  id: string
  user_id: string
  phone_e164: string
  verified_at: string | null
  otp_expires_at: string | null
  otp_attempts: number
  revoked_at: string | null
  created_at: string
  updated_at: string
}

/**
 * The short-lived handoff between the OAuth callback and the account picker.
 * No RLS policy exists for it, so it is reachable only with the service role.
 */
export type OAuthSessionRow = {
  id: string
  user_id: string
  workspace_id: string
  platform: PlatformEnum
  access_token_encrypted: string
  refresh_token_encrypted: string | null
  token_expires_at: string | null
  granted_scopes: string[]
  expires_at: string
  consumed_at: string | null
  created_at: string
}

export type AuditLogRow = {
  id: number
  workspace_id: string | null
  actor_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  source: string
  detail: Json
  created_at: string
}

// --- the Database type supabase-js is generic over ---------------------------

export type Database = {
  public: {
    Tables: {
      users: Table<UserRow, 'id' | 'email'>
      workspaces: Table<WorkspaceRow, 'name' | 'type' | 'owner_id'>
      workspace_members: Table<WorkspaceMemberRow, 'workspace_id' | 'user_id'>
      profiles_setup: Table<ProfileSetupRow, 'workspace_id'>
      invites: Table<InviteRow, 'workspace_id' | 'email' | 'token_hash' | 'expires_at'>
      social_accounts: Table<
        SocialAccountWithTokens,
        'workspace_id' | 'platform' | 'external_account_id'
      >
      account_transfer_requests: Table<
        AccountTransferRequestWithHolder,
        'platform' | 'external_account_id' | 'to_workspace_id' | 'requested_by'
      >
      post_media: Table<PostMediaRow, 'workspace_id' | 'storage_path' | 'mime_type'>
      posts: Table<PostRow, 'workspace_id'>
      post_targets: Table<
        PostTargetRow,
        'post_id' | 'social_account_id' | 'platform' | 'idempotency_key'
      >
      approvals: Table<ApprovalRow, 'post_id' | 'workspace_id'>
      plans: Table<
        PlanRow,
        'code' | 'region' | 'currency' | 'display_name' | 'price_per_seat_minor'
      >
      subscriptions: Table<
        SubscriptionRow,
        'workspace_id' | 'plan_id' | 'region' | 'currency' | 'gateway' | 'current_period_end'
      >
      invoices: Table<InvoiceRow, 'workspace_id' | 'region' | 'currency'>
      invoice_lines: Table<
        InvoiceLineRow,
        'invoice_id' | 'kind' | 'description' | 'unit_amount_minor' | 'amount_minor'
      >
      payments: Table<
        PaymentRow,
        'workspace_id' | 'gateway' | 'gateway_transaction_id' | 'amount_minor' | 'currency'
      >
      gateway_events: Table<GatewayEventRow, 'gateway' | 'event_id' | 'payload'>
      billing_credits: Table<
        BillingCreditRow,
        'workspace_id' | 'currency' | 'amount_minor' | 'remaining_minor' | 'reason'
      >
      ai_credit_ledger: Table<AiCreditLedgerRow, 'workspace_id' | 'kind' | 'amount'>
      ai_plans: Table<AiPlanRow, 'workspace_id'>
      notifications: Table<NotificationRow, 'workspace_id' | 'kind' | 'title'>
      notification_deliveries: Table<
        NotificationDeliveryRow,
        'notification_id' | 'channel'
      >
      whatsapp_links: Table<WhatsappLinkRow, 'user_id' | 'phone_e164'>
      audit_log: Table<AuditLogRow, 'action'>
      oauth_sessions: Table<
        OAuthSessionRow,
        'user_id' | 'workspace_id' | 'platform' | 'access_token_encrypted' | 'expires_at'
      >
    }
    Views: Record<never, never>
    Functions: {
      ai_credit_balance: { Args: { ws: string }; Returns: number }
      is_member: { Args: { ws: string }; Returns: boolean }
      has_role: { Args: { ws: string; minimum: WorkspaceRoleEnum }; Returns: boolean }
      member_role: { Args: { ws: string }; Returns: WorkspaceRoleEnum }
      is_platform_admin: { Args: Record<never, never>; Returns: boolean }
      post_workspace: { Args: { p: string }; Returns: string }
      shares_workspace_with: { Args: { other: string }; Returns: boolean }
      purge_expired_oauth_sessions: { Args: Record<never, never>; Returns: number }
      claim_due_targets: {
        Args: { max_batch?: number; lease_seconds?: number; max_attempts?: number }
        Returns: PostTargetRow[]
      }
      roll_up_post: { Args: { p: string }; Returns: PostStatusEnum }
      reap_stuck_targets: { Args: { max_attempts?: number }; Returns: number }
    }
    Enums: {
      platform: PlatformEnum
      module_type: ModuleTypeEnum
      onboarding_step: OnboardingStepEnum
      post_status: PostStatusEnum
      target_status: TargetStatusEnum
      connection_status: ConnectionStatusEnum
      transfer_status: TransferStatusEnum
      workspace_role: WorkspaceRoleEnum
      billing_region: BillingRegionEnum
      currency: CurrencyEnum
      subscription_status: SubscriptionStatusEnum
      invoice_status: InvoiceStatusEnum
      payment_status: PaymentStatusEnum
      payment_gateway: PaymentGatewayEnum
      ai_ledger_kind: AiLedgerKindEnum
      notification_channel: NotificationChannelEnum
    }
    CompositeTypes: Record<never, never>
  }
}
