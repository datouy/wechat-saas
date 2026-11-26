package com.linlituan.saas.form;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/wx/forms")
public class MemberFormController {
    private final FormService service;

    public MemberFormController(FormService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<FormDtos.FormView>> list() {
        return ApiResponse.ok(service.list(TenantContext.require().tenantId()).stream()
                .filter(item -> "OPEN".equals(item.getStatus())).map(service::view).toList());
    }

    @GetMapping("/{id}")
    public ApiResponse<FormDtos.FormView> detail(@PathVariable Long id) {
        return ApiResponse.ok(service.view(service.get(TenantContext.require().tenantId(), id)));
    }

    @PostMapping("/{id}/submit")
    public ApiResponse<Long> submit(@PathVariable Long id, @RequestBody FormDtos.SubmitRequest request) {
        TenantContext.Context context = TenantContext.require();
        return ApiResponse.ok(service.submit(context.tenantId(), id, context.userId(), request).getId());
    }
}

