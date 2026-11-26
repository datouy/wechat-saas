package com.linlituan.saas.order;

import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderRepository orders;
    private final OrderItemRepository orderItems;
    private final OrderRefundRepository refunds;
    private final MemberRepository members;
    private final OrderService service;

    public OrderController(OrderRepository orders, OrderItemRepository orderItems, OrderRefundRepository refunds,
                           MemberRepository members, OrderService service) {
        this.orders = orders;
        this.orderItems = orderItems;
        this.refunds = refunds;
        this.members = members;
        this.service = service;
    }

    @GetMapping
    public ApiResponse<Page<OrderDtos.OrderView>> list(@RequestParam(required = false) String status,
                                                       @RequestParam(defaultValue = "1") int page,
                                                       @RequestParam(defaultValue = "20") int size) {
        Long tenantId = TenantContext.require().tenantId();
        PageRequest pageable = PageRequest.of(Math.max(0, page - 1), Math.min(100, Math.max(1, size)),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Order> result = status == null || status.isBlank()
                ? orders.findByTenantIdOrderByCreatedAtDesc(tenantId, pageable)
                : orders.findByTenantIdAndStatusOrderByCreatedAtDesc(tenantId, status.trim().toUpperCase(), pageable);
        return ApiResponse.ok(result.map(this::toView));
    }

    @GetMapping("/{id}")
    public ApiResponse<OrderDtos.OrderDetail> detail(@PathVariable Long id) {
        Long tenantId = TenantContext.require().tenantId();
        Order order = orders.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "订单不存在"));
        List<OrderDtos.ItemView> items = orderItems.findByOrderId(order.getId()).stream()
                .map(item -> new OrderDtos.ItemView(item.getProductId(), item.getProductName(),
                        item.getUnitPriceCent(), item.getQuantity(), item.getSubtotalCent()))
                .toList();
        List<OrderDtos.RefundView> refundRows = refunds.findByTenantIdAndOrderIdOrderByCreatedAtDesc(tenantId, id).stream()
                .map(item -> new OrderDtos.RefundView(item.getId(), item.getRefundNo(), item.getAmountCent(),
                        item.getReason(), item.getStatus(), item.getCreatedAt()))
                .toList();
        return ApiResponse.ok(new OrderDtos.OrderDetail(toView(order), items, refundRows));
    }

    @PostMapping("/{id}/pay")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<OrderDtos.OrderView> pay(@PathVariable Long id) {
        return ApiResponse.ok(toView(service.pay(TenantContext.require().tenantId(), id)));
    }

    @PostMapping("/{id}/deliver")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER','FULFILLMENT')")
    public ApiResponse<OrderDtos.OrderView> deliver(@PathVariable Long id,
                                                    @Valid @RequestBody OrderDtos.DeliverRequest request) {
        return ApiResponse.ok(toView(service.deliver(TenantContext.require().tenantId(), id, request)));
    }

    @PostMapping("/{id}/complete")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER','FULFILLMENT')")
    public ApiResponse<OrderDtos.OrderView> complete(@PathVariable Long id) {
        return ApiResponse.ok(toView(service.complete(TenantContext.require().tenantId(), id)));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<OrderDtos.OrderView> cancel(@PathVariable Long id,
                                                   @RequestBody(required = false) java.util.Map<String, String> body) {
        String reason = body == null ? "" : body.getOrDefault("reason", "");
        return ApiResponse.ok(toView(service.cancel(TenantContext.require().tenantId(), id, reason)));
    }

    @PostMapping("/{id}/refund")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<OrderDtos.RefundView> refund(@PathVariable Long id,
                                                    @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                    @RequestBody(required = false) OrderDtos.RefundRequest request) {
        Long amount = request == null ? null : request.amountCent();
        String reason = request == null ? null : request.reason();
        OrderRefund refund = service.refund(TenantContext.require().tenantId(), id, amount, reason, idempotencyKey);
        return ApiResponse.ok(new OrderDtos.RefundView(refund.getId(), refund.getRefundNo(), refund.getAmountCent(),
                refund.getReason(), refund.getStatus(), refund.getCreatedAt()));
    }

    private OrderDtos.OrderView toView(Order order) {
        String memberName = members.findById(order.getMemberId()).map(Member::getNickname).orElse("未知会员");
        return new OrderDtos.OrderView(order.getId(), order.getOrderNo(), order.getStatus(),
                order.getPaymentMode(), order.getGoodsAmountCent(), order.getPayAmountCent(),
                order.getRefundedAmountCent(), memberName, order.getLogisticsCompany(), order.getLogisticsNo(),
                order.getCreatedAt(), order.getDeliveredAt(), order.getCompletedAt());
    }
}

