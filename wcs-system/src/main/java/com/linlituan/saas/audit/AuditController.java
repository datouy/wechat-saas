package com.linlituan.saas.audit;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit-logs")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class AuditController {
    private final AuditLogRepository logs;

    public AuditController(AuditLogRepository logs) {
        this.logs = logs;
    }

    @GetMapping
    public ApiResponse<Page<AuditLog>> list(@RequestParam(required = false) String action,
                                            @RequestParam(defaultValue = "1") int page,
                                            @RequestParam(defaultValue = "20") int size) {
        Long tenantId = TenantContext.require().tenantId();
        PageRequest pageable = PageRequest.of(Math.max(0, page - 1), Math.min(100, Math.max(1, size)),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        return ApiResponse.ok(action == null || action.isBlank()
                ? logs.findByTenantIdOrderByCreatedAtDesc(tenantId, pageable)
                : logs.findByTenantIdAndActionOrderByCreatedAtDesc(tenantId, action.trim(), pageable));
    }
}

