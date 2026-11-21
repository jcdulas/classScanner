// Calls on what a lambda returns, which the scan cannot follow without a compiler (spec §3.3): see tools.cpp and main.cpp.
#pragma once

class Job {
 public:
  void run();
};

class Task {
 public:
  void run();
};

class Pool {
 public:
  Job* nextJob();
  Task* nextTask();
  void work();
};
