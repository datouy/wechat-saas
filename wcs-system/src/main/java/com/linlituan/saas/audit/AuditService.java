package com.linlituan.saas.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.security.TenantContext;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private final AuditLogRepository logs;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository logs, ObjectMapper objectMapper) {
        this.logs = logs;
        this.objectMapper = objectMapper;
    }

    public void record(String action, String resource, String resourceId, Object detail) {
        TenantContext.Context context = TenantContext.require();
        AuditLog log = new AuditLog();
        log.setTenantId(context.tenantId());
        log.setActorType("ADMIN");
        log.setActorId(context.userId());
        log.setActorName(context.username());
        log.setAction(action);
        log.setResource(resource);
        log.setResourceId(resourceId);
        try {
            log.setDetail(detail == null ? "" : objectMapper.writeValueAsString(detail));
        } catch (Exception ex) {
            log.setDetail(String.valueOf(detail));
        }
        logs.save(log);
    }
}

