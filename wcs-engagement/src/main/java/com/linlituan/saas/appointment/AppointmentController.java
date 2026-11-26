package com.linlituan.saas.appointment;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
@PreAuthorize("hasAnyRole('OWNER','MANAGER','FULFILLMENT')")
public class AppointmentController {
    private final AppointmentService service;

    public AppointmentController(AppointmentService service) {
        this.service = service;
    }

    @GetMapping("/appointment-services")
    public ApiResponse<List<AppointmentDtos.ServiceView>> services() {
        return ApiResponse.ok(service.services(TenantContext.require().tenantId()).stream().map(service::serviceView).toList());
    }

    @PostMapping("/appointment-services")
    public ApiResponse<AppointmentDtos.ServiceView> createService(@Valid @RequestBody AppointmentDtos.ServiceRequest request) {
        return ApiResponse.ok(service.serviceView(service.create(TenantContext.require().tenantId(), request)));
    }

    @PutMapping("/appointment-services/{id}")
    public ApiResponse<AppointmentDtos.ServiceView> updateService(@PathVariable Long id,
                                                                  @Valid @RequestBody AppointmentDtos.ServiceRequest request) {
        return ApiResponse.ok(service.serviceView(service.update(TenantContext.require().tenantId(), id, request)));
    }

    @GetMapping("/appointments")
    public ApiResponse<List<AppointmentDtos.AppointmentView>> appointments(@RequestParam(required = false) String status) {
        return ApiResponse.ok(service.list(TenantContext.require().tenantId(), status).stream().map(service::appointmentView).toList());
    }

    @PostMapping("/appointments/{id}/complete")
    public ApiResponse<AppointmentDtos.AppointmentView> complete(@PathVariable Long id) {
        return ApiResponse.ok(service.appointmentView(service.complete(TenantContext.require().tenantId(), id)));
    }

    @PostMapping("/appointments/{id}/cancel")
    public ApiResponse<AppointmentDtos.AppointmentView> cancel(@PathVariable Long id) {
        return ApiResponse.ok(service.appointmentView(service.cancel(TenantContext.require().tenantId(), id, null)));
    }
}

