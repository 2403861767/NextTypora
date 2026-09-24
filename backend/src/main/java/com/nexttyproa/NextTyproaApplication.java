package com.nexttyproa;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.service.ParentProcessMonitor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;

@SpringBootApplication
public class NextTyproaApplication {

    private final ParentProcessMonitor parentProcessMonitor;
    private final AppProperties appProperties;

    public NextTyproaApplication(ParentProcessMonitor parentProcessMonitor, AppProperties appProperties) {
        this.parentProcessMonitor = parentProcessMonitor;
        this.appProperties = appProperties;
    }

    public static void main(String[] args) {
        SpringApplication.run(NextTyproaApplication.class, args);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady(ApplicationReadyEvent event) {
        Environment env = event.getApplicationContext().getEnvironment();
        String port = env.getProperty("local.server.port", "8080");
        // 取 AppProperties 而非原始配置：未配置 token 时这里才是后端实际生成的随机 token
        String token = appProperties.getAuthToken();
        System.err.println("NEXTTYPROA_PORT=" + port);
        System.err.println("NEXTTYPROA_TOKEN=" + token);
        System.err.flush();

        // 启动父进程监控
        parentProcessMonitor.startMonitoring();
    }
}
