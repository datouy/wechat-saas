export interface UserInfo {
  id: number
  username: string
  displayName: string
  role: string
}

export interface TenantInfo {
  id: number
  code: string
  name: string
  status: string
}

export interface LoginResult {
  token: string
  user: UserInfo
  tenant: TenantInfo
}

export interface ApiEnvelope<T> {
  success: boolean
  data: T
  message: string
  code: string
}

export interface PageResult<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
}

export interface DashboardData {
  todayOrders: number
  todayAmountCent: number
  pendingOrders: number
  memberCount: number
  productCount: number
  recentOrders: OrderRow[]
}

export interface OrderRow {
  id: number
  orderNo: string
  status: string
  payAmountCent: number
  memberName: string
  createdAt: string
}

export interface ProductRow {
  id: number
  name: string
  description: string
  imageUrl: string
  categoryId: number | null
  priceCent: number
  originalPriceCent: number
  stock: number
  sales: number
  onSale: boolean
  createdAt: string
}

export interface ProductUpsertPayload {
  name: string
  description: string
  imageUrl?: string
  categoryId?: number | null
  priceCent: number
  originalPriceCent: number
  stock?: number
  onSale: boolean
}

export interface InventoryAdjustmentRow {
  id: number
  productId: number
  productName: string
  beforeStock: number
  delta: number
  afterStock: number
  reason: string
  actorName: string
  createdAt: string
  undoneAt: string | null
  reversedAdjustmentId: number | null
}

export interface OrderPageRow {
  id: number
  orderNo: string
  status: string
  paymentMode: string
  goodsAmountCent: number
  payAmountCent: number
  refundedAmountCent: number
  memberName: string
  logisticsCompany: string
  logisticsNo: string
  createdAt: string
  deliveredAt: string | null
  completedAt: string | null
}

export interface OrderItemRow {
  productId: number
  productName: string
  unitPriceCent: number
  quantity: number
  subtotalCent: number
}

export interface RefundRow {
  id: number
  refundNo: string
  amountCent: number
  reason: string
  status: string
  createdAt: string
}

export interface OrderDetailRow {
  order: OrderPageRow
  items: OrderItemRow[]
  refunds: RefundRow[]
}

export interface MemberRow {
  id: number
  nickname: string
  phone: string
  points: number
  totalSpentCent: number
  orderCount: number
  createdAt: string
}

export interface PointsLedgerRow {
  id: number
  changeAmount: number
  reason: string
  refId: string
  createdAt: string
}

export interface PointsView {
  memberId: number
  nickname: string
  balance: number
  ledger: PointsLedgerRow[]
}

export interface AuditRow {
  id: number
  tenantId: number
  actorType: string
  actorId: number | null
  actorName: string
  action: string
  resource: string
  resourceId: string
  detail: string
  createdAt: string
}


export interface CouponTemplateRow {
  id: number
  name: string
  thresholdCent: number
  amountCent: number
  validDays: number
  limitPerMember: number
  enabled: boolean
  createdAt: string
}

export interface CouponRow {
  id: number
  templateId: number
  memberId: number
  name: string
  thresholdCent: number
  amountCent: number
  status: string
  expireAt: string
  createdAt: string
}

export interface GroupBuyRow {
  id: number
  productId: number
  productName: string
  title: string
  groupPriceCent: number
  minParticipants: number
  maxParticipants: number
  status: string
  startAt: string
  endAt: string
  successAt: string | null
  participantCount: number
  remaining: number
  createdAt: string
}

export interface FormField {
  id: string
  label: string
  type: string
  options: string[]
  required: boolean
}

export interface FormRow {
  id: number
  title: string
  description: string
  fields: FormField[]
  status: string
  createdAt: string
}

export interface FormStatsRow {
  formId: number
  title: string
  total: number
  fields: Array<{
    id: string
    label: string
    type: string
    distribution: Record<string, number>
    average: number | null
    answered: number
  }>
}

export interface AppointmentServiceRow {
  id: number
  name: string
  priceCent: number
  durationMinutes: number
  capacityPerSlot: number
  slots: string[]
  enabled: boolean
  createdAt: string
}

export interface AppointmentRow {
  id: number
  serviceId: number
  serviceName: string
  memberId: number
  appointmentDate: string
  slot: string
  note: string
  status: string
  createdAt: string
}

export interface SubscriptionAdminData {
  templates: Record<string, { templateId?: string; page?: string }>
  outbox: Array<{
    id: number
    event: string
    title: string
    templateId: string
    status: string
    attempts: number
    error: string
    sentAt: string | null
    createdAt: string
  }>
}

