import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "firestore", test: /\/node_modules\/@firebase\/firestore\// },
            { name: "charts", test: /\/node_modules\/(chart\.js|@kurkle\/color)\// }
          ]
        }
      }
    }
  }
});
