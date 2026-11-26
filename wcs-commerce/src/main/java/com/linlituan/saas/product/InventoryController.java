package com.linlituan.saas.product;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/inventory-adjustments")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class InventoryController {
    private final ProductService service;

    public InventoryController(ProductService service) {
        this.service = service;
    }

    @PostMapping("/{id}/undo")
    public ApiResponse<ProductDtos.AdjustmentView> undo(@PathVariable Long id) {
        InventoryAdjustment item = service.undo(TenantContext.require().tenantId(), id);
        return ApiResponse.ok(new ProductDtos.AdjustmentView(item.getId(), item.getProductId(), item.getProductName(),
                item.getBeforeStock(), item.getDelta(), item.getAfterStock(), item.getReason(), item.getActorName(),
                item.getCreatedAt(), item.getUndoneAt(), item.getReversedAdjustmentId()));
    }
}

