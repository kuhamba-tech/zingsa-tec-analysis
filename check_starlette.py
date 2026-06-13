import starlette
import starlette.middleware.gzip as g
import inspect
print('starlette', starlette.__version__)
members = [n for n in dir(g) if 'DEFAULT' in n or 'EXCLUDE' in n or 'content' in n.lower()]
print('members:', members)
src = inspect.getsource(g)
lines = src.splitlines()
print('\n--- gzip.py head (first 200 lines) ---')
print('\n'.join(lines[:200]))
print('\n--- end ---')
