package com.linlituan.saas.dashboard;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.order.Order;
import com.linlituan.saas.order.OrderRepository;
import com.linlituan.saas.product.ProductRepository;
import com.linlituan.saas.security.TenantContext;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final OrderRepository orders;
    private final MemberRepository members;
    private final ProductRepository products;

    public DashboardController(OrderRepository orders, MemberRepository members, ProductRepository products) {
        this.orders = orders;
        this.members = members;
        this.products = products;
    }

    @GetMapping
    public ApiResponse<DashboardView> dashboard() {
        Long tenantId = TenantContext.require().tenantId();
        Instant startOfDay = LocalDate.now(ZoneId.of("Asia/Shanghai"))
                .atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant();
        List<OrderRow> recent = orders.findByTenantIdOrderByCreatedAtDesc(tenantId, PageRequest.of(0, 6))
                .stream()
                .map(this::toRow)
                .toList();
        return ApiResponse.ok(new DashboardView(
                orders.countByTenantIdAndCreatedAtAfter(tenantId, startOfDay),
                orders.sumPaidSince(tenantId, startOfDay),
                orders.countByTenantIdAndStatus(tenantId, "PENDING"),
                members.countByTenantId(tenantId),
                products.countByTenantId(tenantId),
                recent
        ));
    }

    private OrderRow toRow(Order order) {
        String memberName = members.findById(order.getMemberId()).map(Member::getNickname).orElse("未知会员");
        return new OrderRow(order.getId(), order.getOrderNo(), order.getStatus(),
                order.getPayAmountCent(), memberName, order.getCreatedAt());
    }

    public record DashboardView(long todayOrders, long todayAmountCent, long pendingOrders,
                                long memberCount, long productCount, List<OrderRow> recentOrders) {
    }

    public record OrderRow(Long id, String orderNo, String status, Long payAmountCent,
                           String memberName, Instant createdAt) {
    }
}

