package com.linlituan.saas.order;

import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/wx/orders")
public class MemberOrderController {
    private final OrderService service;
    private final OrderRepository orders;
    private final OrderItemRepository items;
    private final MemberRepository members;

    public MemberOrderController(OrderService service, OrderRepository orders,
                                 OrderItemRepository items, MemberRepository members) {
        this.service = service;
        this.orders = orders;
        this.items = items;
        this.members = members;
    }

    @PostMapping
    public ApiResponse<OrderDtos.OrderView> create(@Valid @RequestBody MemberOrderDtos.CreateRequest request) {
        TenantContext.Context context = TenantContext.require();
        Order order = service.createForMember(context.tenantId(), context.userId(), request);
        return ApiResponse.ok(toView(order));
    }

    @GetMapping
    public ApiResponse<List<OrderDtos.OrderView>> list() {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(orders.findByTenantIdAndMemberIdOrderByCreatedAtDesc(context.tenantId(), context.userId())
                .stream().map(this::toView).toList());
    }

    @GetMapping("/{id}")
    public ApiResponse<OrderDtos.OrderDetail> detail(@PathVariable Long id) {
        TenantContext.Context context = TenantContext.require();
        Order order = orders.findByIdAndTenantId(id, context.tenantId())
                .filter(item -> item.getMemberId().equals(context.userId()))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "订单不存在"));
        List<OrderDtos.ItemView> itemViews = items.findByOrderId(order.getId()).stream()
                .map(item -> new OrderDtos.ItemView(item.getProductId(), item.getProductName(),
                        item.getUnitPriceCent(), item.getQuantity(), item.getSubtotalCent()))
                .toList();
        return ApiResponse.ok(new OrderDtos.OrderDetail(toView(order), itemViews, List.of()));
    }

    private OrderDtos.OrderView toView(Order order) {
        String name = members.findById(order.getMemberId()).map(Member::getNickname).orElse("会员");
        return new OrderDtos.OrderView(order.getId(), order.getOrderNo(), order.getStatus(), order.getPaymentMode(),
                order.getGoodsAmountCent(), order.getPayAmountCent(), order.getRefundedAmountCent(), name,
                order.getLogisticsCompany(), order.getLogisticsNo(), order.getCreatedAt(),
                order.getDeliveredAt(), order.getCompletedAt());
    }
}

