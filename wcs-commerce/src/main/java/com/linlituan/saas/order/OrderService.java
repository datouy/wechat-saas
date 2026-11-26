package com.linlituan.saas.order;

import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.member.PointsLedgerEntry;
import com.linlituan.saas.member.PointsLedgerRepository;
import com.linlituan.saas.product.Product;
import com.linlituan.saas.product.ProductRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
public class OrderService {
    private final OrderRepository orders;
    private final OrderItemRepository items;
    private final OrderRefundRepository refunds;
    private final ProductRepository products;
    private final MemberRepository members;
    private final PointsLedgerRepository pointsLedger;
    private final AuditService audit;

    public OrderService(OrderRepository orders, OrderItemRepository items, OrderRefundRepository refunds,
                        ProductRepository products, MemberRepository members, PointsLedgerRepository pointsLedger,
                        AuditService audit) {
        this.orders = orders;
        this.items = items;
        this.refunds = refunds;
        this.products = products;
        this.members = members;
        this.pointsLedger = pointsLedger;
        this.audit = audit;
    }

    @Transactional
    public Order createForMember(Long tenantId, Long memberId, MemberOrderDtos.CreateRequest request) {
        if (request == null || request.items() == null || request.items().isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "ORDER_ITEMS", "订单商品不能为空");
        }
        if (members.findByIdAndTenantId(memberId, tenantId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在");
        }
        java.util.List<OrderItem> lines = new java.util.ArrayList<>();
        long goodsAmount = 0;
        for (MemberOrderDtos.ItemRequest item : request.items()) {
            Product product = products.findByIdAndTenantIdForUpdate(item.productId(), tenantId)
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "商品不存在"));
            if (!Boolean.TRUE.equals(product.getOnSale())) {
                throw new ApiException(HttpStatus.CONFLICT, "PRODUCT_OFFLINE", "商品已下架: " + product.getName());
            }
            int quantity = Math.max(1, item.quantity());
            if (product.getStock() < quantity) {
                throw new ApiException(HttpStatus.CONFLICT, "STOCK_SHORTAGE", "库存不足: " + product.getName());
            }
            product.setStock(product.getStock() - quantity);
            products.save(product);
            OrderItem line = new OrderItem();
            line.setProductId(product.getId());
            line.setProductName(product.getName());
            line.setUnitPriceCent(product.getPriceCent());
            line.setQuantity(quantity);
            line.setSubtotalCent(product.getPriceCent() * quantity);
            lines.add(line);
            goodsAmount += line.getSubtotalCent();
        }
        Order order = new Order();
        order.setTenantId(tenantId);
        order.setMemberId(memberId);
        order.setOrderNo("NT" + System.currentTimeMillis() + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase());
        order.setStatus("PENDING");
        order.setPaymentMode("WECHAT");
        order.setGoodsAmountCent(goodsAmount);
        order.setPayAmountCent(goodsAmount);
        order.setRemark(trim(request.remark(), 200));
        orders.save(order);
        for (OrderItem line : lines) {
            line.setOrderId(order.getId());
            items.save(line);
        }
        audit.record("order.create", "order", String.valueOf(order.getId()),
                Map.of("orderNo", order.getOrderNo(), "amountCent", order.getPayAmountCent()));
        return order;
    }

    @Transactional
    public Order pay(Long tenantId, Long id) {
        Order order = lockOrder(tenantId, id);
        if ("PAID".equals(order.getStatus())) return order;
        if (!"PENDING".equals(order.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "ORDER_STATE", "当前订单状态不允许支付");
        }
        order.setStatus("PAID");
        order.setPaidAt(Instant.now());
        orders.save(order);

        Member member = lockMember(tenantId, order.getMemberId());
        member.setTotalSpentCent(member.getTotalSpentCent() + order.getPayAmountCent());
        member.setOrderCount(member.getOrderCount() + 1);
        long earned = Math.max(0, order.getPayAmountCent() / 100);
        if (earned > 0) {
            member.setPoints(member.getPoints() + earned);
            PointsLedgerEntry entry = new PointsLedgerEntry();
            entry.setTenantId(tenantId);
            entry.setMemberId(member.getId());
            entry.setChangeAmount(earned);
            entry.setReason("订单消费返积分");
            entry.setRefId(order.getOrderNo());
            pointsLedger.save(entry);
        }
        members.save(member);
        audit.record("order.pay", "order", String.valueOf(id),
                Map.of("orderNo", order.getOrderNo(), "amountCent", order.getPayAmountCent(), "pointsEarned", earned));
        return order;
    }

    @Transactional
    public Order deliver(Long tenantId, Long id, OrderDtos.DeliverRequest request) {
        Order order = lockOrder(tenantId, id);
        if (!"PAID".equals(order.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "ORDER_STATE", "仅已支付订单可发货");
        }
        order.setStatus("DELIVERING");
        order.setDeliveredAt(Instant.now());
        order.setLogisticsCompany(trim(request.company(), 50));
        order.setLogisticsNo(trim(request.trackingNo(), 64));
        orders.save(order);
        audit.record("order.deliver", "order", String.valueOf(id),
                Map.of("orderNo", order.getOrderNo(), "company", order.getLogisticsCompany(), "trackingNo", order.getLogisticsNo()));
        return order;
    }

    @Transactional
    public Order complete(Long tenantId, Long id) {
        Order order = lockOrder(tenantId, id);
        if (!"DELIVERING".equals(order.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "ORDER_STATE", "仅配送中订单可确认完成");
        }
        order.setStatus("COMPLETED");
        order.setCompletedAt(Instant.now());
        orders.save(order);
        audit.record("order.complete", "order", String.valueOf(id), Map.of("orderNo", order.getOrderNo()));
        return order;
    }

    @Transactional
    public Order cancel(Long tenantId, Long id, String reason) {
        Order order = lockOrder(tenantId, id);
        if (!"PENDING".equals(order.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "ORDER_STATE", "仅待支付订单可取消");
        }
        restoreInventory(tenantId, order);
        order.setStatus("CANCELLED");
        order.setCancelledAt(Instant.now());
        order.setRemark(trim(reason, 200));
        orders.save(order);
        audit.record("order.cancel", "order", String.valueOf(id), Map.of("orderNo", order.getOrderNo(), "reason", order.getRemark()));
        return order;
    }

    @Transactional
    public OrderRefund refund(Long tenantId, Long id, Long amountCent, String reason, String idempotencyKey) {
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            OrderRefund existing = refunds.findByTenantIdAndIdempotencyKey(tenantId, idempotencyKey.trim()).orElse(null);
            if (existing != null) return existing;
        }
        Order order = lockOrder(tenantId, id);
        if (!java.util.Set.of("PAID", "DELIVERING", "COMPLETED").contains(order.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "ORDER_STATE", "当前订单状态不支持退款");
        }
        long already = order.getRefundedAmountCent() == null ? 0 : order.getRefundedAmountCent();
        long refundable = order.getPayAmountCent() - already;
        if (refundable <= 0) throw new ApiException(HttpStatus.CONFLICT, "REFUND_EXHAUSTED", "订单已全额退款");
        long target = amountCent == null ? refundable : amountCent;
        if (target <= 0 || target > refundable) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "REFUND_AMOUNT", "退款金额超过可退金额");
        }
        boolean full = target == refundable;
        if (full) restoreInventory(tenantId, order);
        order.setRefundedAmountCent(already + target);
        if (full) order.setStatus("REFUNDED");
        orders.save(order);

        OrderRefund refund = new OrderRefund();
        refund.setTenantId(tenantId);
        refund.setOrderId(order.getId());
        refund.setOrderNo(order.getOrderNo());
        refund.setRefundNo("RF" + order.getOrderNo().substring(2) + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase());
        refund.setAmountCent(target);
        refund.setReason(reason == null || reason.isBlank() ? "用户申请退款" : trim(reason, 200));
        refund.setStatus("SUCCESS");
        refund.setIdempotencyKey(idempotencyKey == null || idempotencyKey.isBlank() ? null : trim(idempotencyKey, 96));
        refunds.save(refund);

        if (full) {
            Member member = lockMember(tenantId, order.getMemberId());
            member.setTotalSpentCent(Math.max(0, member.getTotalSpentCent() - order.getPayAmountCent()));
            member.setOrderCount(Math.max(0, member.getOrderCount() - 1));
            members.save(member);
        }
        audit.record("order.refund", "order", String.valueOf(id),
                Map.of("orderNo", order.getOrderNo(), "refundNo", refund.getRefundNo(), "amountCent", target, "full", full));
        return refund;
    }

    public Order lockOrder(Long tenantId, Long id) {
        return orders.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "订单不存在"));
    }

    private Member lockMember(Long tenantId, Long id) {
        return members.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
    }

    private void restoreInventory(Long tenantId, Order order) {
        for (OrderItem item : items.findByOrderId(order.getId())) {
            Product product = products.findByIdAndTenantIdForUpdate(item.getProductId(), tenantId).orElse(null);
            if (product == null) continue;
            product.setStock(product.getStock() + item.getQuantity());
            product.setSales(Math.max(0, product.getSales() - item.getQuantity()));
            products.save(product);
        }
    }

    private String trim(String value, int max) {
        return value == null ? "" : value.trim().substring(0, Math.min(max, value.trim().length()));
    }
}

