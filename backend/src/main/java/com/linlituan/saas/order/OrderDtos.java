package com.linlituan.saas.order;

import jakarta.validation.constraints.Positive;

import java.time.Instant;
import java.util.List;

public final class OrderDtos {
    private OrderDtos() {
    }

    public record DeliverRequest(String company, String trackingNo) {
    }

    public record RefundRequest(@Positive(message = "退款金额必须大于 0") Long amountCent, String reason) {
    }

    public record OrderView(Long id, String orderNo, String status, String paymentMode,
                            Long goodsAmountCent, Long payAmountCent, Long refundedAmountCent,
                            String memberName, String logisticsCompany, String logisticsNo,
                            Instant createdAt, Instant deliveredAt, Instant completedAt) {
    }

    public record ItemView(Long productId, String productName, Long unitPriceCent,
                           Integer quantity, Long subtotalCent) {
    }

    public record RefundView(Long id, String refundNo, Long amountCent, String reason,
                             String status, Instant createdAt) {
    }

    public record OrderDetail(OrderView order, List<ItemView> items, List<RefundView> refunds) {
    }
}

