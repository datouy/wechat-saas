package com.linlituan.saas.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public final class MemberOrderDtos {
    private MemberOrderDtos() {
    }

    public record ItemRequest(Long productId, @Min(value = 1, message = "商品数量至少为 1") int quantity) {
    }

    public record CreateRequest(@NotEmpty(message = "订单商品不能为空") List<ItemRequest> items, String remark) {
    }
}

