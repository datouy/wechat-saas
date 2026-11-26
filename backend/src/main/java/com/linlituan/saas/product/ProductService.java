package com.linlituan.saas.product;

import com.linlituan.saas.audit.AuditService;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.security.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ProductService {
    private final ProductRepository products;
    private final ProductCategoryRepository categories;
    private final InventoryAdjustmentRepository adjustments;
    private final AuditService audit;

    public ProductService(ProductRepository products, ProductCategoryRepository categories,
                          InventoryAdjustmentRepository adjustments, AuditService audit) {
        this.products = products;
        this.categories = categories;
        this.adjustments = adjustments;
        this.audit = audit;
    }

    @Transactional
    public Product create(Long tenantId, ProductDtos.CreateRequest request) {
        validateCategory(tenantId, request.categoryId());
        Product product = new Product();
        product.setTenantId(tenantId);
        product.setCategoryId(request.categoryId());
        product.setName(request.name().trim());
        product.setDescription(trim(request.description(), 500));
        product.setImageUrl(trim(request.imageUrl(), 500));
        product.setPriceCent(request.priceCent());
        product.setOriginalPriceCent(request.originalPriceCent());
        product.setStock(request.stock());
        product.setSales(0);
        product.setOnSale(request.onSale() == null || request.onSale());
        products.save(product);
        audit.record("product.create", "product", String.valueOf(product.getId()),
                java.util.Map.of("name", product.getName(), "priceCent", product.getPriceCent(), "stock", product.getStock()));
        return product;
    }

    @Transactional
    public Product update(Long tenantId, Long id, ProductDtos.UpdateRequest request) {
        Product product = lockProduct(tenantId, id);
        validateCategory(tenantId, request.categoryId());
        if (request.name() != null) product.setName(request.name().trim());
        if (request.description() != null) product.setDescription(trim(request.description(), 500));
        if (request.imageUrl() != null) product.setImageUrl(trim(request.imageUrl(), 500));
        if (request.categoryId() != null) product.setCategoryId(request.categoryId());
        if (request.priceCent() != null) product.setPriceCent(request.priceCent());
        if (request.originalPriceCent() != null) product.setOriginalPriceCent(request.originalPriceCent());
        if (request.onSale() != null) product.setOnSale(request.onSale());
        products.save(product);
        audit.record("product.update", "product", String.valueOf(id),
                java.util.Map.of("name", product.getName(), "priceCent", product.getPriceCent(), "onSale", product.getOnSale()));
        return product;
    }

    @Transactional
    public Product offShelf(Long tenantId, Long id) {
        Product product = lockProduct(tenantId, id);
        product.setOnSale(false);
        products.save(product);
        audit.record("product.off-shelf", "product", String.valueOf(id), java.util.Map.of("name", product.getName()));
        return product;
    }

    @Transactional
    public InventoryAdjustment adjustStock(Long tenantId, Long productId, ProductDtos.InventoryRequest request) {
        Product product = lockProduct(tenantId, productId);
        int delta = request.delta();
        if (delta == 0) throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION", "库存调整数量不能为 0");
        int after = product.getStock() + delta;
        if (after < 0) throw new ApiException(HttpStatus.BAD_REQUEST, "STOCK_INVALID", "调整后库存不能小于 0");
        int before = product.getStock();
        product.setStock(after);
        products.save(product);

        TenantContext.Context context = TenantContext.require();
        InventoryAdjustment record = new InventoryAdjustment();
        record.setTenantId(tenantId);
        record.setProductId(product.getId());
        record.setProductName(product.getName());
        record.setBeforeStock(before);
        record.setDelta(delta);
        record.setAfterStock(after);
        record.setReason(request.reason().trim());
        record.setActorId(context.userId());
        record.setActorName(context.username());
        adjustments.save(record);
        audit.record("inventory.adjust", "product", String.valueOf(productId),
                java.util.Map.of("before", before, "delta", delta, "after", after, "reason", record.getReason()));
        return record;
    }

    @Transactional
    public InventoryAdjustment undo(Long tenantId, Long adjustmentId) {
        InventoryAdjustment original = adjustments.findByIdAndTenantId(adjustmentId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "库存调整记录不存在"));
        if (original.getUndoneAt() != null || original.getReversedAdjustmentId() != null) {
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_UNDONE", "该库存调整已经撤销");
        }
        Product product = lockProduct(tenantId, original.getProductId());
        int before = product.getStock();
        int after = before - original.getDelta();
        if (after < 0) throw new ApiException(HttpStatus.CONFLICT, "STOCK_INVALID", "当前库存不足以撤销这次调整");
        product.setStock(after);
        products.save(product);
        original.setUndoneAt(java.time.Instant.now());
        adjustments.save(original);

        TenantContext.Context context = TenantContext.require();
        InventoryAdjustment reversal = new InventoryAdjustment();
        reversal.setTenantId(tenantId);
        reversal.setProductId(product.getId());
        reversal.setProductName(product.getName());
        reversal.setBeforeStock(before);
        reversal.setDelta(-original.getDelta());
        reversal.setAfterStock(after);
        reversal.setReason("撤销库存调整：" + original.getReason());
        reversal.setActorId(context.userId());
        reversal.setActorName(context.username());
        reversal.setReversedAdjustmentId(original.getId());
        adjustments.save(reversal);
        original.setReversedAdjustmentId(reversal.getId());
        adjustments.save(original);
        audit.record("inventory.adjust-undo", "product", String.valueOf(product.getId()),
                java.util.Map.of("adjustmentId", adjustmentId, "reversalId", reversal.getId(), "after", after));
        return reversal;
    }

    public List<InventoryAdjustment> listAdjustments(Long tenantId, Long productId) {
        products.findByIdAndTenantId(productId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "商品不存在"));
        return adjustments.findTop50ByTenantIdAndProductIdOrderByCreatedAtDesc(tenantId, productId);
    }

    private Product lockProduct(Long tenantId, Long id) {
        return products.findByIdAndTenantIdForUpdate(id, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "商品不存在"));
    }

    private void validateCategory(Long tenantId, Long categoryId) {
        if (categoryId != null && categories.findByIdAndTenantId(categoryId, tenantId).isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CATEGORY_INVALID", "商品分类不存在");
        }
    }

    private String trim(String value, int max) {
        return value == null ? "" : value.trim().substring(0, Math.min(max, value.trim().length()));
    }
}

