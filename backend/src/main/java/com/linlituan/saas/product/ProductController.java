package com.linlituan.saas.product;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final ProductRepository products;
    private final ProductService service;

    public ProductController(ProductRepository products, ProductService service) {
        this.products = products;
        this.service = service;
    }

    @GetMapping
    public ApiResponse<Page<ProductDtos.ProductView>> list(@RequestParam(required = false) String keyword,
                                                           @RequestParam(defaultValue = "1") int page,
                                                           @RequestParam(defaultValue = "20") int size) {
        Long tenantId = TenantContext.require().tenantId();
        PageRequest pageable = PageRequest.of(Math.max(0, page - 1), Math.min(100, Math.max(1, size)),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Product> result = keyword == null || keyword.isBlank()
                ? products.findByTenantIdOrderByCreatedAtDesc(tenantId, pageable)
                : products.findByTenantIdAndNameContainingIgnoreCaseOrderByCreatedAtDesc(tenantId, keyword.trim(), pageable);
        return ApiResponse.ok(result.map(this::toView));
    }

    @GetMapping("/{id}")
    public ApiResponse<ProductDtos.ProductView> detail(@PathVariable Long id) {
        Long tenantId = TenantContext.require().tenantId();
        Product product = products.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new com.linlituan.saas.common.ApiException(org.springframework.http.HttpStatus.NOT_FOUND, "NOT_FOUND", "商品不存在"));
        return ApiResponse.ok(toView(product));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<ProductDtos.ProductView> create(@Valid @RequestBody ProductDtos.CreateRequest request) {
        return ApiResponse.ok(toView(service.create(TenantContext.require().tenantId(), request)));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<ProductDtos.ProductView> update(@PathVariable Long id,
                                                       @Valid @RequestBody ProductDtos.UpdateRequest request) {
        return ApiResponse.ok(toView(service.update(TenantContext.require().tenantId(), id, request)));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<ProductDtos.ProductView> delete(@PathVariable Long id) {
        return ApiResponse.ok(toView(service.offShelf(TenantContext.require().tenantId(), id)));
    }

    @GetMapping("/{id}/inventory-adjustments")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<List<ProductDtos.AdjustmentView>> adjustments(@PathVariable Long id) {
        return ApiResponse.ok(service.listAdjustments(TenantContext.require().tenantId(), id).stream().map(this::toAdjustment).toList());
    }

    @PostMapping("/{id}/inventory-adjustments")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<ProductDtos.AdjustmentView> adjust(@PathVariable Long id,
                                                          @Valid @RequestBody ProductDtos.InventoryRequest request) {
        return ApiResponse.ok(toAdjustment(service.adjustStock(TenantContext.require().tenantId(), id, request)));
    }

    private ProductDtos.ProductView toView(Product product) {
        return new ProductDtos.ProductView(product.getId(), product.getName(), product.getDescription(),
                product.getImageUrl(), product.getCategoryId(), product.getPriceCent(), product.getOriginalPriceCent(),
                product.getStock(), product.getSales(), product.getOnSale(), product.getCreatedAt());
    }

    private ProductDtos.AdjustmentView toAdjustment(InventoryAdjustment item) {
        return new ProductDtos.AdjustmentView(item.getId(), item.getProductId(), item.getProductName(),
                item.getBeforeStock(), item.getDelta(), item.getAfterStock(), item.getReason(), item.getActorName(),
                item.getCreatedAt(), item.getUndoneAt(), item.getReversedAdjustmentId());
    }
}

