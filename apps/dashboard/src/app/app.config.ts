import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { unauthorizedInterceptor } from './auth';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { appRoutes } from './app.routes';
import { currentDirection } from './page-motion';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([unauthorizedInterceptor])),
    // Route changes run in a View Transition where the browser has one; elsewhere they swap at once.
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      // The page slides in the direction of the navigation (see page-motion.ts): forward, or back for a Back.
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition }) => {
          const root = document.documentElement;
          root.dataset['navDirection'] = currentDirection();
          void transition.finished.finally(() => delete root.dataset['navDirection']);
        },
      }),
    )
  ]
};
