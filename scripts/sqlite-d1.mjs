import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export class SQLiteD1 {
 constructor(path=':memory:'){this.db=new DatabaseSync(path);this.db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));}
 prepare(sql){return new Statement(this.db,sql);}
 async batch(statements){this.db.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 close(){this.db.close();}
}
class Statement{
 constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.db,this.sql,args);}
 execute(){const stmt=this.db.prepare(this.sql);let results=[],changes=0;if(stmt.columns().length)results=stmt.all(...this.args);else changes=stmt.run(...this.args).changes;return {success:true,results,meta:{changes}};}
 async first(){return this.execute().results[0]||null;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
