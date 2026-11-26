package com.linlituan.saas.product;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public final class ProductDtos {
    private ProductDtos() {
    }

    public record CreateRequest(
            @NotBlank(message = "商品名称不能为空") String name,
            String description,
            String imageUrl,
            Long categoryId,
            @NotNull(message = "请输入商品价格") @Positive(message = "商品价格必须大于 0") Long priceCent,
            @NotNull(message = "请输入原价") @Positive(message = "原价必须大于 0") Long originalPriceCent,
            @NotNull(message = "请输入库存") @Min(value = 0, message = "库存不能为负数") Integer stock,
            Boolean onSale
    ) {
    }

    public record UpdateRequest(
            String name,
            String description,
            String imageUrl,
            Long categoryId,
            @Positive(message = "商品价格必须大于 0") Long priceCent,
            @Positive(message = "原价必须大于 0") Long originalPriceCent,
            Boolean onSale
    ) {
    }

    public record InventoryRequest(
            @NotNull(message = "请输入调整数量") Integer delta,
            @NotBlank(message = "请填写调整原因") String reason
    ) {
    }

    public record ProductView(Long id, String name, String description, String imageUrl,
                              Long categoryId, Long priceCent, Long originalPriceCent,
                              Integer stock, Integer sales, Boolean onSale, java.time.Instant createdAt) {
    }

    public record AdjustmentView(Long id, Long productId, String productName, Integer beforeStock,
                                 Integer delta, Integer afterStock, String reason, String actorName,
                                 java.time.Instant createdAt, java.time.Instant undoneAt,
                                 Long reversedAdjustmentId) {
    }
}

