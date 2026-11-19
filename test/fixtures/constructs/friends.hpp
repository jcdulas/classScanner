// Friend classes and friend functions.
class Inspector;

class Secret {
  friend class Inspector;
  friend struct ns::Auditor;
  friend void dump(const Secret& secret);
  int code;
};
